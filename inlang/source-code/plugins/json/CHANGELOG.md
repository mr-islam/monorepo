# @inlang/plugin-json

## 5.1.2

### Patch Changes

- Updated dependencies [bc5803235]
  - @inlang/sdk@0.20.0

## 5.1.1

### Patch Changes

- Updated dependencies [8b05794d5]
  - @inlang/sdk@0.19.0

## 5.1.0

### Minor Changes

- cafff8748: adjust tests and fix erros message

### Patch Changes

- Updated dependencies [cafff8748]
  - @inlang/sdk@0.17.0

## 5.0.0

### Major Changes

- 55d4c3497: The matcher functionallity of plugins is now unbundled. Former paraglide-jsplugin is moved to plugins and named m-function-matcher and the matching functionallity pf the json plugin is now unbundled in the t-function-matcher plugin.

## 4.10.0

### Minor Changes

- a39638334: add support for new document selector typescriptreact

## 4.9.0

### Minor Changes

- 2150b4873: fix: path patterns can start as as an absolute path like `/resources/{languageTag}.json`

## 4.8.0

### Minor Changes

- 2f924df32: added Modulesettings validation via the Typebox JSON Schema Validation. This ensure that users can exclusively use module settings when there are given by the moduel

### Patch Changes

- Updated dependencies [2f924df32]
  - @inlang/sdk@0.16.0

## 4.7.0

### Minor Changes

- 0055f20b1: update README

## 4.6.1

### Patch Changes

- 4668f637a: Added test for empty object in nested translation file.
- Updated dependencies [2976a4b15]
  - @inlang/sdk@0.10.0

## 4.6.0

### Minor Changes

- f40ab4ca9: refactor: use plugin api v2

### Patch Changes

- Updated dependencies [0f9dc72b3]
  - @inlang/sdk@0.9.0

## 4.5.0

### Minor Changes

- b7dfc781e: change message format match from object to array

### Patch Changes

- Updated dependencies [b7dfc781e]
  - @inlang/sdk@0.8.0

## 4.4.0

### Minor Changes

- 7e112af9: isolated detect formating function for plugins

### Patch Changes

- Updated dependencies [7e112af9]
  - @inlang/detect-formatting@0.2.0

## 4.3.0

### Minor Changes

- 0d0502f4: deprecate detectedLanguageTags

### Patch Changes

- Updated dependencies [0d0502f4]
  - @inlang/plugin@1.3.0

## 4.2.0

### Minor Changes

- 25fe8502: refactor: remove plugin.meta and messageLintRule.meta nesting

### Patch Changes

- Updated dependencies [25fe8502]
  - @inlang/plugin@1.2.0

## 4.1.0

### Minor Changes

- 973858c6: chore(fix): remove unpublished dependency which lead to installation failing

### Patch Changes

- Updated dependencies [973858c6]
  - @inlang/plugin@1.1.0

## 3.0.12

### Patch Changes

- Remove login of "files" in console

## 3.0.11

### Patch Changes

- 77a6deed: Added test for unused folder in language dir (fixed ignore at getLanguages)

## 3.0.10

### Patch Changes

- 61ec4dac: chore: fix the id of the plugin from `inlang.plugin-i18next` to `inlang.plugin-json`

## 3.0.9

### Patch Changes

- 0c82623d: fix ignore folder at getLanguage function

## 3.0.8

### Patch Changes

- 12fe1943: support language folders and addLanguage button

## 3.0.7

### Patch Changes

- 80dc45d4: Added icon and changed links to point on json plugin in monorepo

## 3.0.6

### Patch Changes

- ceae4a83: fix: prevent split(regex) from generating empty text elements

## 3.0.5

### Patch Changes

- 6326e01e: fix: placeholder matching https://github.com/inlang/monorepo/issues/955

## 3.0.4

### Patch Changes

- 138df7cc: fix: don't match functions that ends with a t but are not a t function like somet("key").

## 3.0.3

### Patch Changes

- db4949e3: Internal refactoring by using the i18next plugin as base.

## 3.0.2

### Patch Changes

- 65c3af4b: Changed readme

## 3.0.1

### Patch Changes

- cbe0f68e: Fix github workflow

## 3.0.0

### Major Changes

- ad123f89: added json-plugin to monorepo

### Patch Changes

- 8310bb43: Fixed test
