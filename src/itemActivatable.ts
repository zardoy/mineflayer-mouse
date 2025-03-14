import MinecraftData from 'minecraft-data'
import { Item } from 'prismarine-item'
import { itemToBlockRemaps } from './itemBlocksStatic'

export const isItemActivatable = (version: string, item: Pick<Item, 'name'>) => {
    if (!item) return false
    const mcData = MinecraftData(version)
    const blockData = mcData.blocksByName[itemToBlockRemaps[item.name] ?? item.name]
    if (blockData) {
        return false
    }

    return true
}
