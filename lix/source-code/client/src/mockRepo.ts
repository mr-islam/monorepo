import { openRepository } from "./openRepository.js"
import { createNodeishMemoryFs, fromSnapshot } from "@lix-js/fs"
// @ts-ignore
import repoDaata from "./ci-test-repo.js"

export async function mockRepo() {
	const nodeishFs = createNodeishMemoryFs()

	const snapshot = repoDaata
	// JSON.parse(readFileSync("../mocks/ci-test-repo.json", { encoding: "utf-8" }))
	fromSnapshot(nodeishFs, snapshot)

	const repo = await openRepository("https://github.com/inlang/ci-test-repo", {
		nodeishFs,
	})

	repo.getMeta = async () => {
		return {
			id: "34c48e4ba4c128582466b8dc1330feac0733880b35f467f4161e259070d24a31",
			name: "ci-test-repo",
			isPrivate: false,
			isFork: true,
			permissions: { admin: false, push: false, pull: false },
			owner: { name: undefined, email: undefined, login: "inlang" },
			parent: { url: "github.com/inlang/example.git", fullName: "inlang/example" },
		}
	}

	return repo
}
