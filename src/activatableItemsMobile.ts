import { IndexedData } from 'minecraft-data'
import activatableItemsMobile from './activatableItemsMobile.json'

export default activatableItemsMobile

export const isItemActivatableMobile = (itemName: string, data: IndexedData) => {
    return activatableItemsMobile.includes(itemName) || data.foodsByName[itemName] !== undefined
}
