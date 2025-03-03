import { Bot } from 'mineflayer'
import { Entity } from 'prismarine-entity'
import { Vec3 } from 'vec3'
import { iterators } from 'prismarine-world'
import { getBotEyeHeight } from './botCommon'
import { Shape } from 'prismarine-world/types/iterators'
import { isEntityAttackable } from './attackableEntity'
import MinecraftData from 'minecraft-data'

export const raycastEntity = (bot: Bot) => {
    const minecraftData = MinecraftData(bot.version)

    // TODO shouldn't .5 be added to maxDistance?
    let maxDistance = bot.game.gameMode === 'creative' ? 5 : 3
    const block = bot.blockAtCursor(maxDistance)
    maxDistance = block?.['intersect'].distanceTo(bot.entity.position) ?? maxDistance

    const entityCandidates = Object.values(bot.entities)
        .filter(entity => entity.username !== bot.username)

    const dir = new Vec3(-Math.sin(bot.entity.yaw) * Math.cos(bot.entity.pitch), Math.sin(bot.entity.pitch), -Math.cos(bot.entity.yaw) * Math.cos(bot.entity.pitch))
    const iterator = new iterators.RaycastIterator(bot.entity.position.offset(0, getBotEyeHeight(bot), 0), dir.normalize(), maxDistance)

    let targetEntity: Entity | null = null
    let targetDist = maxDistance

    for (const entity of entityCandidates) {
        const w = entity.width / 2

        const shapes = [[-w, 0, -w, w, entity.height, w]] as Shape[]
        const intersect = iterator.intersect(shapes, entity.position)
        if (intersect) {
            const entityDir = entity.position.minus(bot.entity.position) // Can be combined into 1 line
            const sign = Math.sign(entityDir.dot(dir))
            if (sign !== -1) {
                const dist = bot.entity.position.distanceTo(intersect.pos)
                if (dist < targetDist) {
                    if (isEntityAttackable(minecraftData, entity)) {
                        targetEntity = entity
                        targetDist = dist
                    }
                }
            }
        }
    }

    return targetEntity
}
