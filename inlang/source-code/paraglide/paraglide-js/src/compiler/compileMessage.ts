import { LanguageTag, type Message } from "@inlang/sdk"
import { compilePattern } from "./compilePattern.js"
import { paramsType, type Params } from "./paramsType.js"
import { optionsType } from "./optionsType.js"
import { isValidJSIdentifier } from "../services/valid-js-identifier/index.js"
import { toStringUnion } from "../services/codegen/string-union.js"
import { i } from "../services/codegen/identifier.js"

/**
 * Returns the compiled messages for the given message.
 *
 * @example
 *   {
 *      index: "export const hello_world = (params) => { ... }",
 *      en: "export const hello_world = (params) => { ... }",
 *      de: "export const hello_world = (params) => { ... }",
 *   }
 */
export const compileMessage = (
	message: Message
): {
	index: string
	[languageTag: string]: string
} => {
	// choosing a regex for valid JS variable names is too long.
	// (because JS allows almost any function or variable names).
	if (!isValidJSIdentifier(message.id)) {
		throw new Error(
			`Cannot compile message with ID "${message.id}".\n\nThe message is not a valid JavaScript variable name. Please choose a different ID.\n\nTo detect this issue during linting, use the valid-js-identifier lint rule: https://inlang.com/m/teldgniy/messageLintRule-inlang-validJsIdentifier`
		)
	}

	const compiledPatterns: Record<LanguageTag, string> = {}
	// parameter names and TypeScript types
	// only allowing types that JS transpiles to strings under the hood like string and number.
	// the pattern nodes must be extended to hold type information in the future.
	let params: Params = {}
	const languageTags = new Set<LanguageTag>()
	for (const variant of message.variants) {
		if (compiledPatterns[variant.languageTag]) {
			throw new Error(
				`Duplicate language tag: ${variant.languageTag}. Multiple variants for one language tag are not supported in paraglide yet. `
			)
		}
		const { compiled, params: variantParams } = compilePattern(variant.pattern)
		// merge params
		params = { ...params, ...variantParams }
		languageTags.add(variant.languageTag)
		// set the pattern for the language tag
		compiledPatterns[variant.languageTag] = compiled
	}

	return {
		index: messageIndexFunction({ message, params, languageTags }),
		...Object.fromEntries(
			[...languageTags].map((languageTag) => [
				languageTag,
				// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
				messageFunction({ message, params, compiledPattern: compiledPatterns[languageTag]! }),
			])
		),
	}
}

const messageIndexFunction = (args: {
	message: Message
	params: Params
	languageTags: Set<LanguageTag>
}) => {
	const hasParams = Object.keys(args.params).length > 0

	return `/**
 * This message has been compiled by [inlang paraglide](https://inlang.com/m/gerre34r/library-inlang-paraglideJs).
 *
 * - Don't edit the message's code. Use the [inlang ide extension](https://inlang.com/m/r7kp499g/app-inlang-ideExtension),
 *   the [web editor](https://inlang.com/m/tdozzpar/app-inlang-editor) instead, or edit the translation files manually.
 * 
 * - The params are NonNullable<unknown> because the inlang SDK does not provide information on the type of a param (yet).
 * 
 * ${paramsType(args.params, true)}
 * ${optionsType({ languageTags: args.languageTags })}
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const ${args.message.id} = (params ${hasParams ? "" : "= {}"}, options = {}) => {
	const messageFunction = {
${[...args.languageTags]
	// sort language tags alphabetically to make the generated code more readable
	.sort((a, b) => a.localeCompare(b))
	.map((tag) => `\t\t${isValidJSIdentifier(tag) ? tag : `"${tag}"`}: ${i(tag)}.${args.message.id}`)
	.join(",\n")}
	}[/** @type {${toStringUnion(args.languageTags)}} */ (options.languageTag ?? languageTag())]

	// if the language tag does not exist, return undefined
	// 
	// the missing translation lint rule catches errors like this in CI/CD
	// see https://inlang.com/m/4cxm3eqi/messageLintRule-inlang-missingTranslation
	// @ts-expect-error - for better DX treat a message function is always returning a string
	return messageFunction ? messageFunction(${hasParams ? "params" : ""}) : undefined;
}`
}

const messageFunction = (args: { message: Message; params: Params; compiledPattern: string }) => {
	return `
/**
 * ${paramsType(args.params, false)}
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const ${args.message.id} = (${Object.keys(args.params).length > 0 ? "params" : ""}) => ${
		args.compiledPattern
	}`
}
