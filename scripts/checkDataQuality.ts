import MinecraftData, { versions } from 'minecraft-data'
import entityData from '../src/entityData.json'

const latestVersion = versions.pc[0].minecraftVersion
console.log('Latest Minecraft version:', latestVersion)
const mcData = MinecraftData(latestVersion)

// Get all entity names from minecraft-data
const mcDataEntities = new Set(Object.values(mcData.entities).map(e => e.name))

// Get all entities from our entityData
const ourEntities = new Set([...entityData.attackable, ...entityData.notAttackable, ...Object.keys(entityData.entityRenames)])

// Find entities that are in minecraft-data but not in our entityData
const missingEntities = [...mcDataEntities].filter(entity => !ourEntities.has(entity))

// Find entities that are in our entityData but not in minecraft-data
const extraEntities = [...ourEntities].filter(entity => !mcDataEntities.has(entity))

console.log('\nMissing entities (in minecraft-data but not in our entityData):')
console.log(missingEntities)

console.log('\nExtra entities (in our entityData but not in minecraft-data):')
console.log(extraEntities)

if (missingEntities.length === 0 && extraEntities.length === 0) {
    console.log('\nAll entities are properly accounted for!')
    process.exit(0)
} else {
    console.log('\nDiscrepancies found in entity lists')
    process.exit(1)
}
