import type { InlangConfig } from "@inlang/config"
import type { InlangEnvironment } from "@inlang/environment"
import { TranslatedStrings } from "@inlang/language-tag"
import type { LintRule } from "@inlang/lint-api"
import type { Message } from "@inlang/messages"
import { z } from "zod"

type JSONSerializable<
	T extends Record<string, string | string[] | Record<string, string | string[]>>,
> = T

/**
 * The plugin API is used to extend inlang's functionality.
 */
export type PluginApi<
	PluginOptions extends Record<string, string | string[]> = Record<string, never>,
	AppSpecificApis extends object = {},
> = {
	// * Must be JSON serializable if we want an external plugin manifest in the future.
	meta: JSONSerializable<{
		id: `${string}.${string}`
		displayName: TranslatedStrings
		description: TranslatedStrings
		keywords: string[]
		/**
		 * The APIs that the plugin uses.
		 *
		 * If the plugin uses an API that is not listed here, the plugin will not be loaded.
		 * Mainly used for the plugin marketplace.
		 */
		usedApis: z.infer<typeof Plugin>["meta"]["usedApis"]
	}>
	/**
	 * The setup function is the first function that is called when inlang loads the plugin.
	 *
	 * Use the setup function to initialize state, handle the options and more.
	 */
	setup: (args: { options: PluginOptions; config: Readonly<InlangConfig> }) => {
		/**
		 * Load messages.
		 *
		 * - if messages with language tags that are not defined in the config.languageTags
		 *   are returned, the user config will be automatically updated to include the
		 *   new language tags.
		 */
		loadMessages?: (args: {}) => Promise<Message[]> | Message[]
		saveMessages?: (args: { messages: Message[] }) => Promise<void> | void
		addLintRules?: () => LintRule[]
		/**
		 * Define app specific APIs.
		 *
		 * @example
		 * addAppSpecificApi: () => ({
		 * 	 "inlang.ide-extension": {
		 * 	   messageReferenceMatcher: () => {}
		 * 	 }
		 *  })
		 */
		addAppSpecificApi?: () => AppSpecificApis
		// afterSetup: () => {}
	}
}

export type ResolvePlugins = <AppSpecificApis extends object = {}>(args: {
	config: InlangConfig
	env: InlangEnvironment
}) => Promise<ResolvedPluginsApi<AppSpecificApis>>

/**
 * The API after resolving the plugins.
 */
export type ResolvedPluginsApi<AppSpecificApis extends object = {}> = {
	loadMessages: () => Promise<Message[]>
	saveMessages: (args: { messages: Message[] }) => Promise<void>
	lintRules: LintRule[]
	/**
	 * App specific APIs.
	 *
	 * @example
	 *  appSpecificApi["inlang.ide-extension"].messageReferenceMatcher()
	 */
	appSpecificApi: AppSpecificApis
}

// --------------------------------------------- ZOD ---------------------------------------------

export const Plugin = z.object({
	meta: z.object({
		id: z.string(),
		displayName: TranslatedStrings,
		description: TranslatedStrings,
		keywords: z.array(z.string()),
		usedApis: z.array(
			z.union([
				z.literal("loadMessages"),
				z.literal("saveMessages"),
				z.literal("addLintRules"),
				z.literal("addAppSpecificApi"),
			]),
		),
	}),
	setup: z
		.function()
		.args(z.object({ options: z.record(z.string()), inlang: z.any() }))
		.returns(
			z.object({
				loadMessages: z.function().returns(z.array(z.any())).optional(),
				saveMessages: z
					.function()
					.args(z.object({ messages: z.array(z.any()) }))
					.returns(z.void())
					.optional(),
				addLintRules: z.function().returns(z.array(z.any())).optional(),
			}),
		),
})
