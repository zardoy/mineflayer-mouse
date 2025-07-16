import fs from 'fs'
import MinecraftData, { versions } from 'minecraft-data'
import { isBlockActivatable } from '../src/itemBlocksStatic'

const latestVersion = versions.pc[0].minecraftVersion
console.log('latestVersion', latestVersion)
const data = MinecraftData(latestVersion)

// Get all blocks that are not items
const blocksNotItems = data.itemsArray.filter(item => {
    // Some blocks have corresponding items, we want only pure blocks
    const blockVersion = data.blocksByName[item.name]
    return !!blockVersion
})

// Separate blocks into activatable and non-activatable
const activatableBlocks = blocksNotItems
    .filter(block => isBlockActivatable(block.name))
    .map(block => block.name)
    .sort()

const nonActivatableBlocks = blocksNotItems
    .filter(block => !isBlockActivatable(block.name))
    .map(block => block.name)
    .sort()

// Create the JSON structure
const blocksData = {
    version: latestVersion,
    activatableBlocks,
    nonActivatableBlocks
}

// Write to file
fs.writeFileSync('./validate-data/blockData.json', JSON.stringify(blocksData, null, 4) + '\n')

console.log(`Generated block data for ${activatableBlocks.length} activatable blocks and ${nonActivatableBlocks.length} non-activatable blocks`)
