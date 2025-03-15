import { Entity } from 'prismarine-entity'
import { IndexedData, Entity as EntityData } from 'minecraft-data'
import { snakeCase } from 'change-case'
import entitiesStaticData from './entityData.json'
import Debug from 'debug'
import { debug } from './debug'

// TODO support REDIRECTABLE_PROJECTILE

const allEntityNames = Object.fromEntries([...entitiesStaticData.attackable, ...entitiesStaticData.notAttackable].map(x => [x, true]))
const attackableEntityNames = entitiesStaticData.attackable

export const isEntityAttackable = (data: IndexedData, entity: Entity) => {
    if (!entity.name) throw new Error('Entity has no name')
    const originalEntityData = data.entitiesByName[entity.name]

    const entityRename = entitiesStaticData.entityRenames[entity.name] || entitiesStaticData.entityRenames[snakeCase(entity.name)]
    let latestEntityName = entityRename || entity.name
    if (!allEntityNames[latestEntityName]) {
        latestEntityName = snakeCase(latestEntityName)
        if (!allEntityNames[latestEntityName]) {
            debug(`Cannot find entity ${latestEntityName} in entityData.json`)
            return false
        }
    }

    const hardcodedCheck = hardcodedChecks[latestEntityName]
    if (hardcodedCheck) return hardcodedCheck(entity, originalEntityData)
    return attackableEntityNames.includes(latestEntityName)
}

const hardcodedChecks = {
    armor_stand: isArmorStandAttackable
}

export function isArmorStandAttackable(entity: Entity, entityData: EntityData) {
    const clientFlags = Number(entity.metadata?.[entityData.metadataKeys?.indexOf('client_flags') ?? 14] ?? 0)
    const isMarker = (clientFlags & 16) !== 0
    const showBasePlate = (clientFlags & 8) !== 0
    const showArms = (clientFlags & 4) !== 0
    const isSmall = (clientFlags & 1) !== 0
    return !isMarker
}
