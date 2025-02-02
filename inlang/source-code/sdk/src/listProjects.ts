import type { NodeishFilesystem } from "@lix-js/fs"

export const listProjects = async (
	nodeishFs: NodeishFilesystem,
	from: string
): Promise<Array<{ projectPath: string }>> => {
	// !TODO: Remove this limit once we introduce caching
	const recursionLimit = 5

	const projects: Array<{ projectPath: string }> = []

	async function searchDir(path: string, depth: number) {
		if (depth > recursionLimit) {
			return
		}

		const files = await nodeishFs.readdir(path)
		for (const file of files) {
			const filePath = `${path}/${file}`
			const stats = await nodeishFs.stat(filePath)
			if (stats.isDirectory()) {
				if (file === "node_modules") continue
				if (file.endsWith(".inlang")) {
					projects.push({ projectPath: filePath })
				} else {
					await searchDir(filePath, depth + 1)
				}
			}
		}
	}

	await searchDir(from, 0)

	// remove double slashes
	for (const project of projects) {
		project.projectPath = project.projectPath.replace(/\/\//g, "/")
	}
	return projects
}
