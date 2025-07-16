import * as fs from 'fs'
import * as path from 'path'

function sortJsonItems(data: any): any {
    if (Array.isArray(data)) {
        // Sort arrays of strings
        if (data.every(item => typeof item === 'string')) {
            return data.sort()
        }
        // Recursively sort array items if they are objects
        return data.map(item => sortJsonItems(item))
    } else if (typeof data === 'object' && data !== null) {
        // Sort object keys and recursively sort their values
        const sortedObj: any = {}
        const sortedKeys = Object.keys(data).sort()

        for (const key of sortedKeys) {
            sortedObj[key] = sortJsonItems(data[key])
        }
        return sortedObj
    }
    return data
}

function sortJsonFile(inputPath: string, outputPath?: string) {
    try {
        // Read the input file
        const jsonData = JSON.parse(fs.readFileSync(inputPath, 'utf8'))

        // Sort the data
        const sortedData: any = {}
        for (const [key, value] of Object.entries(jsonData)) {
            sortedData[key] = sortJsonItems(value)
        }

        // Determine output path (use input path if output not specified)
        const finalOutputPath = outputPath || inputPath

        // Write the sorted data back to file with proper formatting
        fs.writeFileSync(
            finalOutputPath,
            JSON.stringify(sortedData, null, 4) + '\n'
        )

        console.log(`Successfully sorted JSON data in ${finalOutputPath}`)
    } catch (error) {
        console.error('Error processing JSON file:', error)
    }
}

// Example usage with entityData.json
const entityDataPath = path.join(__dirname, 'validate-data', 'blockData.json')
sortJsonFile(entityDataPath)
