import fs from 'fs'
import MinecraftData, { versions } from 'minecraft-data'
import { isItemActivatable } from '../src/itemActivatable'

const latestVersion = versions.pc[0].minecraftVersion
console.log('latestVersion', latestVersion)
const data = MinecraftData(latestVersion)

const activatableItems = data.itemsArray.filter(item => isItemActivatable(latestVersion, item)).map(item => item.name)

// make activatableItems.json

const activatableItemsJson = {
    activatableItems: activatableItems
}

fs.writeFileSync('./validate-data/activatableItems.json', JSON.stringify(activatableItemsJson, null, 2))
