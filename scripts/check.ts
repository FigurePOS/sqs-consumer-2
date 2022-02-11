import * as fs from "fs"

export const run = () => {
    const file = fs.readFileSync("./result.txt", { encoding: "utf8" })
    const lines = file.trim().split("\n")

    const dict = new Map<string, number>()

    const data = lines.map((l) => JSON.parse(l))

    data.forEach((d) => {
        const group = d.group
        const id = parseInt(d.id)
        const lastProcessed = dict[group] ?? 0
        if (id <= lastProcessed) {
            console.error("error", dict, d)
        }
        dict[group] = id
    })

    console.log(dict)
}

run()
