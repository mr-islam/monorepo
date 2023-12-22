/* eslint-disable @typescript-eslint/no-non-null-assertion */
import type {
	InlangProject,
	InstalledMessageLintRule,
	InstalledPlugin,
	Subscribable,
} from "./api.js"
import { type ImportFunction, resolveModules } from "./resolve-modules/index.js"
import { TypeCompiler, ValueErrorType } from "@sinclair/typebox/compiler"
import {
	ProjectSettingsFileJSONSyntaxError,
	ProjectSettingsFileNotFoundError,
	ProjectSettingsInvalidError,
	PluginLoadMessagesError,
	PluginSaveMessagesError,
	LoadProjectInvalidArgument,
} from "./errors.js"
import { createRoot, createSignal, createEffect } from "./reactivity/solid.js"
import { createMessagesQuery } from "./createMessagesQuery.js"
import { debounce } from "throttle-debounce"
import { createMessageLintReportsQuery } from "./createMessageLintReportsQuery.js"
import { ProjectSettings, Message, type NodeishFilesystemSubset } from "./versionedInterfaces.js"
import { tryCatch, type Result } from "@inlang/result"
import { migrateIfOutdated } from "@inlang/project-settings/migration"
import { createNodeishFsWithAbsolutePaths } from "./createNodeishFsWithAbsolutePaths.js"
import { normalizePath, type NodeishFilesystem, getDirname } from "@lix-js/fs"
import { isAbsolutePath } from "./isAbsolutePath.js"
import { createNodeishFsWithWatcher } from "./createNodeishFsWithWatcher.js"
import { maybeMigrateToDirectory } from "./migrations/migrateToDirectory.js"
import {
	getMessageIdFromPath,
	getPathFromMessageId,
	parseMessage,
	encodeMessage,
} from "./storage/helper.js"
import { humanId } from "human-id"
import { humanIdHash } from "./storage/human-id/human-readable-id.js"

const settingsCompiler = TypeCompiler.Compile(ProjectSettings)

/**
 * Creates an inlang instance.
 *
 * @param projectPath - Absolute path to the inlang settings file.
 * @param nodeishFs - Filesystem that implements the NodeishFilesystemSubset interface.
 * @param _import - Use `_import` to pass a custom import function for testing,
 *   and supporting legacy resolvedModules such as CJS.
 * @param _capture - Use `_capture` to capture events for analytics.
 *
 */
export const loadProject = async (args: {
	projectPath: string
	nodeishFs: NodeishFilesystem
	_import?: ImportFunction
	_capture?: (id: string, props: Record<string, unknown>) => void
}): Promise<InlangProject> => {
	const projectPath = normalizePath(args.projectPath)

	// -- migrate if outdated ------------------------------------------------

	await maybeMigrateToDirectory({ nodeishFs: args.nodeishFs, projectPath })

	// -- validation --------------------------------------------------------
	// the only place where throwing is acceptable because the project
	// won't even be loaded. do not throw anywhere else. otherwise, apps
	// can't handle errors gracefully.

	if (!isAbsolutePath(args.projectPath)) {
		throw new LoadProjectInvalidArgument(
			`Expected an absolute path but received "${args.projectPath}".`,
			{ argument: "projectPath" }
		)
	} else if (/[^\\/]+\.inlang$/.test(projectPath) === false) {
		throw new LoadProjectInvalidArgument(
			`Expected a path ending in "{name}.inlang" but received "${projectPath}".\n\nValid examples: \n- "/path/to/micky-mouse.inlang"\n- "/path/to/green-elephant.inlang\n`,
			{ argument: "projectPath" }
		)
	}

	// -- load project ------------------------------------------------------
	return await createRoot(async () => {
		const [initialized, markInitAsComplete, markInitAsFailed] = createAwaitable()
		const nodeishFs = createNodeishFsWithAbsolutePaths({
			projectPath,
			nodeishFs: args.nodeishFs,
		})

		// -- settings ------------------------------------------------------------

		const [settings, _setSettings] = createSignal<ProjectSettings>()
		createEffect(() => {
			loadSettings({ settingsFilePath: projectPath + "/settings.json", nodeishFs })
				.then((settings) => {
					setSettings(settings)
					// rename settings to get a convenient access to the data in Posthog
					const project_settings = settings
					args._capture?.("SDK used settings", { project_settings })
				})
				.catch((err) => {
					markInitAsFailed(err)
				})
		})
		// TODO: create FS watcher and update settings on change

		const writeSettingsToDisk = skipFirst((settings: ProjectSettings) =>
			_writeSettingsToDisk({ nodeishFs, settings, projectPath })
		)

		const setSettings = (settings: ProjectSettings): Result<void, ProjectSettingsInvalidError> => {
			try {
				const validatedSettings = parseSettings(settings)
				_setSettings(validatedSettings)

				writeSettingsToDisk(validatedSettings)
				return { data: undefined }
			} catch (error: unknown) {
				if (error instanceof ProjectSettingsInvalidError) {
					return { error }
				}

				throw new Error(
					"Unhandled error in setSettings. This is an internal bug. Please file an issue."
				)
			}
		}

		// -- resolvedModules -----------------------------------------------------------

		const [resolvedModules, setResolvedModules] =
			createSignal<Awaited<ReturnType<typeof resolveModules>>>()

		createEffect(() => {
			const _settings = settings()
			if (!_settings) return

			resolveModules({ settings: _settings, nodeishFs, _import: args._import })
				.then((resolvedModules) => {
					setResolvedModules(resolvedModules)
				})
				.catch((err) => markInitAsFailed(err))
		})

		// -- messages ----------------------------------------------------------

		let settingsValue: ProjectSettings
		createEffect(() => (settingsValue = settings()!)) // workaround to not run effects twice (e.g. settings change + modules change) (I'm sure there exists a solid way of doing this, but I haven't found it yet)

		// please don't use this as source of truth, use the query instead
		// needed for granular linting
		const [messages, setMessages] = createSignal<Message[]>()

		const [messageParseErrors, setMessageParseErrors] = createSignal<Record<string, Error>>({})

		const messageFolderPath = projectPath + "/messages" + "/v1"

		createEffect(() => {
			const _resolvedModules = resolvedModules()
			if (!_resolvedModules) return

			const loadAndSetMessages = async (fs: NodeishFilesystemSubset) => {
				// load all messages
				const loadedMessages: Message[] = []

				try {
					// make sure the message folder exists within the .inlang folder
					try {
						await fs.mkdir(messageFolderPath, { recursive: true })
					} catch (e) {
						if ((e as any).code !== "EEXIST") {
							throw e
						}
					}

					const readFilesFromFolderRecursive = async (
						fileSystem: NodeishFilesystemSubset,
						rootPath: string,
						pathToRead: string
					) => {
						let filePaths: string[] = []
						const paths = await fileSystem.readdir(rootPath + pathToRead)
						for (const path of paths) {
							const stat = await fileSystem.stat(rootPath + pathToRead + "/" + path)

							if (stat.isDirectory()) {
								const subfolderPaths = await readFilesFromFolderRecursive(
									fileSystem,
									rootPath,
									pathToRead + "/" + path
								)
								filePaths = filePaths.concat(subfolderPaths)
							} else {
								filePaths.push(pathToRead + "/" + path)
							}
						}
						return filePaths
					}
					const messageFilePaths = await readFilesFromFolderRecursive(fs, messageFolderPath, "")
					for (const messageFilePath of messageFilePaths) {
						const messageId = getMessageIdFromPath(messageFilePath)
						try {
							if (!messageId) {
								// ignore files not matching the expected id file path
								continue
							}

							const messageRaw = await fs.readFile(`${messageFolderPath}${messageFilePath}`, {
								encoding: "utf-8",
							})

							// TODO #1844 the place where we read in the file - if this fails we should consider ignoring it -> add error to messageParseErrors Array and ignore it for now
							const message = parseMessage(messageFilePath, messageRaw) as Message
							//tf
							//
							// message parsing was successfull remove entry in erros map if it exists
							// TODO #1844
							// if (messageParseErrors!) {
							// 	messageParseErrors!().delete[messageId]
							// 	setMessageParseErrors(messageParseErrors!)
							// }
							loadedMessages.push(message)
						} catch (e) {
							// TODO #1844
							// messageParseErrors!.set(
							// 	messageId,
							// 	new LoadMessageError({
							// 		path: messageFilePath,
							// 		messageId,
							// 		cause: e,
							// 	})
							// )
							// setMessageParseErrors(messageParseErrors)
						}
					}

					setMessages(loadedMessages)

					markInitAsComplete()
				} catch (err) {
					markInitAsFailed(new PluginLoadMessagesError({ cause: err }))
				}
			}

			// setup watchers on message files
			loadAndSetMessages(nodeishFs).then(() => {
				// when initial message loading is done start watching on file changes in the message dir
				;(async () => {
					try {
						// NOTE: We dont use the abortController at the moment - this is the same for the SDK everywhere atm.
						// const abortController = new AbortController()
						const watcher = nodeishFs.watch(messageFolderPath, {
							// signal: abortController.signal,
							persistent: false,
							recursive: true,
						})
						if (watcher) {
							//eslint-disable-next-line @typescript-eslint/no-unused-vars
							for await (const event of watcher) {
								if (!event.filename) {
									throw new Error("filename not set in event...")
								}

								const messageId = getMessageIdFromPath(event.filename)
								if (!messageId) {
									continue
								}

								let fileContent: string | undefined
								try {
									fileContent = await nodeishFs.readFile(
										messageFolderPath + "/" + event.filename!,
										{ encoding: "utf-8" }
									)
								} catch (e) {
									// check for file not exists error (expected in case of deletion of a message) rethrow on everything else
									if ((e as any).code !== "ENOENT") {
										throw e
									}
								}

								if (!fileContent) {
									// file was deleted - drop the corresponding message
									messagesQuery.delete({ where: { id: messageId } })
								} else {
									try {
										const message = parseMessage(event.filename, fileContent)
										// TODO #1844
										// if (messageParseErrors![messageId]) {
										// 	delete messageParseErrors![messageId]
										// 	setMessageParseErrors(messageParseErrors)
										// }
										const currentMessage = messagesQuery.get({ where: { id: messageId } })
										const currentMessageEncoded = encodeMessage(currentMessage)
										if (currentMessage && currentMessageEncoded === fileContent) {
											continue
										}

										messagesQuery.upsert({ where: { id: messageId }, data: message })
									} catch (e) {
										// TODO #1844
										// messageParseErrors[messageId] = new LoadMessageError(messageId, messagePath, {
										// 	cause: e,
										// })
										// setMessageParseErrors(messageParseErrors)
									}
								}
							}
						}
					} catch (err: any) {
						if (err.name === "AbortError") return
						throw err
					}
				})()
			})
		})

		// -- installed items ----------------------------------------------------

		const installedMessageLintRules = () => {
			if (!resolvedModules()) return []
			return resolvedModules()!.messageLintRules.map(
				(rule) =>
					({
						id: rule.id,
						displayName: rule.displayName,
						description: rule.description,
						module:
							resolvedModules()?.meta.find((m) => m.id.includes(rule.id))?.module ??
							"Unknown module. You stumbled on a bug in inlang's source code. Please open an issue.",
						// default to warning, see https://github.com/inlang/monorepo/issues/1254
						level: settingsValue["messageLintRuleLevels"]?.[rule.id] ?? "warning",
					} satisfies InstalledMessageLintRule)
			) satisfies Array<InstalledMessageLintRule>
		}

		const installedPlugins = () => {
			if (!resolvedModules()) return []
			return resolvedModules()!.plugins.map((plugin) => ({
				id: plugin.id,
				displayName: plugin.displayName,
				description: plugin.description,
				module:
					resolvedModules()?.meta.find((m) => m.id.includes(plugin.id))?.module ??
					"Unknown module. You stumbled on a bug in inlang's source code. Please open an issue.",
			})) satisfies Array<InstalledPlugin>
		}

		// -- app ---------------------------------------------------------------

		const initializeError: Error | undefined = await initialized.catch((error) => error)
		const abortController = new AbortController()
		const hasWatcher = nodeishFs.watch("/", { signal: abortController.signal }) !== undefined

		const messagesQuery = createMessagesQuery(() => messages() || [])

		let trackedMessages: Map<string, () => void> = new Map()
		// subscribe to all messages and write to files on signal
		createEffect(() => {
			const currentMessageIds = messagesQuery.includedMessageIds()
			const deletedMessageTrackedMessage = [...trackedMessages].filter(
				(tracked) => !currentMessageIds.includes(tracked[0])
			)
			for (const messageId of currentMessageIds) {
				if (!trackedMessages!.has(messageId!)) {
					// to avoid to drop the effect after creation we need to create a new disposable root
					createRoot((dispose) => {
						createEffect(() => {
							const message = messagesQuery.get({ where: { id: messageId } })!
							if (!message) {
								return
							}
							if (trackedMessages?.has(messageId)) {
								const persistMessage = async (
									fs: NodeishFilesystemSubset,
									path: string,
									message: Message
								) => {
									let dir = getDirname(path)
									dir = dir.endsWith("/") ? dir.slice(0, -1) : dir

									try {
										await fs.mkdir(dir, { recursive: true })
									} catch (e) {
										// TODO #1844 check expected error here - rethrow on unexpected
									}

									await fs.writeFile(path, encodeMessage(message))
								}
								const messageFilePath = messageFolderPath + "/" + getPathFromMessageId(message.id)
								// TODO #1844 non awaited promise - how to handle errors on persistence - guess we add them to the project errors
								persistMessage(nodeishFs, messageFilePath, message)
							} else {
								// initial effect execution - add dispose function
								trackedMessages?.set(messageId, dispose)
							}
						})
					})
				}
			}

			for (const deletedMessage of deletedMessageTrackedMessage) {
				const messageFilePath = messageFolderPath + "/" + getPathFromMessageId(deletedMessage[0])
				try {
					nodeishFs.rm(messageFilePath)
				} catch (e) {
					if ((e as any).code !== "ENOENT") {
						throw e
					}
				}
				// dispose
				trackedMessages.get(deletedMessage[0])?.()
				trackedMessages.delete(deletedMessage[0])
			}
		})

		// TODO #1844 CLEARIFY this was used to create a watcher on all files that the fs reads - shall we import on every change as well?
		// const fsWithWatcher = createNodeishFsWithWatcher({
		// 	nodeishFs: nodeishFs,
		// 	updateMessages: () => {
		// 		// TODO #1844 this is where the messages are loaded (all) when the message file changed
		// 		// TODO #1844 do we still need to reload all messages when plugins change - guess not
		// 		// loadAndSetMessages(nodeishFs)
		// 	},
		// })

		// run import
		const _resolvedModules = resolvedModules()
		// initial project setup finished - import all messages usign legacy load Messages
		if (_resolvedModules?.resolvedPluginApi.loadMessages) {
			// get plugin id by finding the plugin that provides loadMessages function
			const loadMessagePlugin = _resolvedModules.plugins.find(
				(plugin) => plugin.loadMessages !== undefined
			)
			const loadPluginId = loadMessagePlugin!.id

			const importedMessages = await makeTrulyAsync(
				_resolvedModules.resolvedPluginApi.loadMessages({
					// @ts-ignore
					settings: settingsValue,
					nodeishFs: nodeishFs,
				})
			)

			const messagesToImportSorted = importedMessages.sort((importMessageA, importMessageB) =>
				importMessageA.id.localeCompare(importMessageB.id)
			)
			for (const importedMessage of messagesToImportSorted) {
				const currentMessages = messagesQuery
					.getAll()
					// TODO #1585 here we match using the id to support legacy load message plugins - after we introduced import / export methods we will use importedMessage.alias
					.filter((message) => message.alias[loadPluginId] === importedMessage.id)

				if (currentMessages.length > 1) {
					// TODO #1844 CLEARIFY how to handle the case that we find a dublicated alias during import? - change Error correspondingly
					throw new Error("more than one message with the same alias found ")
				} else if (currentMessages.length === 1) {
					// update message in place - leave message id and alias untouched
					importedMessage.alias = {} as any
					// TODO #1585 we have to map the id of the importedMessage to the alias and fill the id property with the id of the existing message - change when import mesage provides importedMessage.alias
					importedMessage.alias[loadPluginId] = importedMessage.id
					importedMessage.alias["library.inlang.paraglideJs"] = importedMessage.id
					importedMessage.id = currentMessages[0]!.id
					const importedEnecoded = encodeMessage(importedMessage)
					const currentMessageEncoded = encodeMessage(currentMessages[0]!)
					if (importedEnecoded === currentMessageEncoded) {
						continue
					}
					messagesQuery.update({ where: { id: importedMessage.id }, data: importedMessage })
				} else {
					// message with the given alias does not exist so far
					importedMessage.alias = {} as any
					// TODO #1585 we have to map the id of the importedMessage to the alias - change when import mesage provides importedMessage.alias
					importedMessage.alias[loadPluginId] = importedMessage.id
					importedMessage.alias["library.inlang.paraglideJs"] = importedMessage.id

					let currentOffset = 0
					let messsageId: string | undefined
					do {
						messsageId = humanIdHash(importedMessage.id, currentOffset)
						const path = /* messageFolderPath + "/" +*/ getPathFromMessageId(messsageId)
						try {
							await nodeishFs.stat(path)
						} catch (e) {
							for (let a = 0; a < 1000; a++) {
								console.log(
									"asdsadasdasdsadsadasdasdasdasdasdsadasdasdasdasdasddsadasdasdasdasdasdJOJO" +
										(e as any).code
								)
							}
							if ((e as any).code === "ENOENT") {
								// keep the message id!
								continue
							}
							throw e
						}

						currentOffset += 1
						messsageId = undefined
					} while (messsageId === undefined)

					// create a humanId based on a hash of the alias
					importedMessage.id = messsageId

					// TODO #1844 CLEARIFY - we don't block fs here - we could have a situation where a file with the same message id is created in the meantime
					messagesQuery.create({ data: importedMessage })
				}
			}
		}

		const lintReportsQuery = createMessageLintReportsQuery(
			messagesQuery,
			settings as () => ProjectSettings,
			installedMessageLintRules,
			resolvedModules,
			hasWatcher
		)

		// const debouncedSave = skipFirst(
		// 	debounce(
		// 		500,
		// 		async (newMessages) => {
		// 			try {
		// 				await resolvedModules()?.resolvedPluginApi.saveMessages({
		// 					settings: settingsValue,
		// 					messages: newMessages,
		// 				})
		// 			} catch (err) {
		// 				throw new PluginSaveMessagesError({
		// 					cause: err,
		// 				})
		// 			}
		// 		},
		// 		{ atBegin: false }
		// 	)
		// )

		// createEffect(() => {
		// 	debouncedSave(messagesQuery.getAll())
		// })

		return {
			installed: {
				plugins: createSubscribable(() => installedPlugins()),
				messageLintRules: createSubscribable(() => installedMessageLintRules()),
			},
			errors: createSubscribable(() => [
				...(initializeError ? [initializeError] : []),
				...(resolvedModules() ? resolvedModules()!.errors : []),
				// ...Object.values(messageParseErrors()),
				// have a query error exposed
				//...(lintErrors() ?? []),
			]),
			settings: createSubscribable(() => settings() as ProjectSettings),
			setSettings,
			customApi: createSubscribable(() => resolvedModules()?.resolvedPluginApi.customApi || {}),
			query: {
				messages: messagesQuery,
				messageLintReports: lintReportsQuery,
			},
		} satisfies InlangProject
	})
}

//const x = {} as InlangProject

// ------------------------------------------------------------------------------------------------

const loadSettings = async (args: {
	settingsFilePath: string
	nodeishFs: NodeishFilesystemSubset
}) => {
	const { data: settingsFile, error: settingsFileError } = await tryCatch(
		async () => await args.nodeishFs.readFile(args.settingsFilePath, { encoding: "utf-8" })
	)
	if (settingsFileError)
		throw new ProjectSettingsFileNotFoundError({
			cause: settingsFileError,
			path: args.settingsFilePath,
		})

	const json = tryCatch(() => JSON.parse(settingsFile!))

	if (json.error) {
		throw new ProjectSettingsFileJSONSyntaxError({
			cause: json.error,
			path: args.settingsFilePath,
		})
	}
	return parseSettings(json.data)
}

const parseSettings = (settings: unknown) => {
	const withMigration = migrateIfOutdated(settings as any)
	if (settingsCompiler.Check(withMigration) === false) {
		const typeErrors = [...settingsCompiler.Errors(settings)]
		if (typeErrors.length > 0) {
			throw new ProjectSettingsInvalidError({
				errors: typeErrors,
			})
		}
	}

	const { sourceLanguageTag, languageTags } = settings as ProjectSettings
	if (!languageTags.includes(sourceLanguageTag)) {
		throw new ProjectSettingsInvalidError({
			errors: [
				{
					message: `The sourceLanguageTag "${sourceLanguageTag}" is not included in the languageTags "${languageTags.join(
						'", "'
					)}". Please add it to the languageTags.`,
					type: ValueErrorType.String,
					schema: ProjectSettings,
					value: sourceLanguageTag,
					path: "sourceLanguageTag",
				},
			],
		})
	}

	return withMigration
}

const _writeSettingsToDisk = async (args: {
	projectPath: string
	nodeishFs: NodeishFilesystemSubset
	settings: ProjectSettings
}) => {
	const { data: serializedSettings, error: serializeSettingsError } = tryCatch(() =>
		// TODO: this will probably not match the original formatting
		JSON.stringify(args.settings, undefined, 2)
	)
	if (serializeSettingsError) {
		throw serializeSettingsError
	}

	const { error: writeSettingsError } = await tryCatch(async () =>
		args.nodeishFs.writeFile(args.projectPath + "/settings.json", serializedSettings)
	)

	if (writeSettingsError) {
		throw writeSettingsError
	}
}

// ------------------------------------------------------------------------------------------------

const createAwaitable = () => {
	let resolve: () => void
	let reject: () => void

	const promise = new Promise<void>((res, rej) => {
		resolve = res
		reject = rej
	})

	return [promise, resolve!, reject!] as [
		awaitable: Promise<void>,
		resolve: () => void,
		reject: (e: unknown) => void
	]
}

// ------------------------------------------------------------------------------------------------

// TODO: create global util type
type MaybePromise<T> = T | Promise<T>

const makeTrulyAsync = <T>(fn: MaybePromise<T>): Promise<T> => (async () => fn)()

// Skip initial call, eg. to skip setup of a createEffect
function skipFirst(func: (args: any) => any) {
	let initial = false
	return function (...args: any) {
		if (initial) {
			// @ts-ignore
			return func.apply(this, args)
		}
		initial = true
	}
}

export function createSubscribable<T>(signal: () => T): Subscribable<T> {
	return Object.assign(signal, {
		subscribe: (callback: (value: T) => void) => {
			createEffect(() => {
				callback(signal())
			})
		},
	})
}
