import { Bot } from 'mineflayer';
import { Block } from 'prismarine-block';
import { activatableBlockWithoutItemPatterns, itemToBlockRemaps } from './itemBlocksStatic';
import  PrismarineItem  from 'prismarine-item'
import  PrismarineBlock  from 'prismarine-block'
import { Vec3 } from 'vec3';
import MinecraftData from 'minecraft-data'

export const directionToVector = [new Vec3(0, -1, 0), new Vec3(0, 1, 0), new Vec3(0, 0, -1), new Vec3(0, 0, 1), new Vec3(-1, 0, 0), new Vec3(1, 0, 0)]
const directionToAxis = ['y', 'y', 'z', 'z', 'x', 'x']
const directionToFacing = ['south', 'west', 'north', 'east', 'up', 'down']

export const botTryPlaceBlockPrediction = (bot: Bot, cursorBlock: Block, faceNum: number, delta: Vec3, doWorldUpdate: boolean) => {
    if (!bot.heldItem) return false
    const isSneaking = bot.controlState.sneak;
    const adventurePlaceAllowed = bot.heldItem.blocksCanPlaceOn?.some(([blockName]) => blockName === cursorBlock.name) ?? false
    const isBlockPlaceAction =
        bot.game.gameMode === 'adventure' ? adventurePlaceAllowed : (
            isSneaking ||
            // not interact action
            activatableBlockWithoutItemPatterns.every(pattern => !pattern.test(cursorBlock.name))
        )
    if (!isBlockPlaceAction) return false;

    const referencePosition = cursorBlock.position.clone()
    const block = bot.world.getBlock(referencePosition)
    const directionVector = block.boundingBox === 'empty' ? new Vec3(0, 0, 0) : directionToVector[faceNum]!

    if (doWorldUpdate) {
        const cursorY = delta.y
        let half = cursorY > 0.5 ? 'top' : 'bottom'
        if (faceNum === 0) half = 'top'
        else if (faceNum === 1) half = 'bottom'
        const placedPosition = referencePosition.plus(directionVector)
        const axis = directionToAxis[faceNum]
        const facing = directionToFacing[faceNum]
        const mcData = MinecraftData(bot.version)
        const itemName = bot.heldItem.name;
        const block = mcData.blocksByName[itemToBlockRemaps[itemName] ?? itemName]
        if (block) {
            const prismarineBlock = PrismarineBlock(bot.version).fromStateId(block.defaultState, 0)
            block.states
            bot.world.setBlockStateId(placedPosition, block?.defaultState)
        }
    }
    // const placingBlock =
    return true
}

// const blockToProperties = (block: MinecraftData.Block, properties: Record<string, string>) => {
//     const states = block.states;
//     if (!states) return null
// }
