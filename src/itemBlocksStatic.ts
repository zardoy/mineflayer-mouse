export const activatableItems = [
  'egg',
  'fishing_rod',
  'firework_rocket',
  'fire_charge',
  'snowball',
  'ender_pearl',
  'experience_bottle',
  'potion',
  'glass_bottle',
  'bucket',
  'water_bucket',
  'lava_bucket',
  'milk_bucket',
  'minecart',
  'boat',
  'tnt_minecart',
  'chest_minecart',
  'hopper_minecart',
  'command_block_minecart',
  'armor_stand',
  'lead',
  'name_tag',
  'writable_book',
  'written_book',
  'compass',
  'clock',
  'filled_map',
  'empty_map',
  'map',
  'shears',
  'carrot_on_a_stick',
  'warped_fungus_on_a_stick',
  'spawn_egg',
  'trident',
  'crossbow',
  'elytra',
  'shield',
  'turtle_helmet',
  'bow',
  'crossbow',
  'bucket_of_cod'
] as const

// these have
// protected InteractionResult useWithoutItem
// but not protected InteractionResult useItemOn
export const activatableBlockWithoutItemPatterns = [
  // Containers
  /^(barrel|hopper|dispenser|dropper)$/,
  /^.*chest$/,
  /^.*shulker_box$/,
  /^.*(furnace|smoker)$/,
  /^(brewing_stand|beacon)$/,
  // Crafting
  /^.*table$/,
  /^(grindstone|stonecutter|loom|smithing_table|cartography_table)$/,
  /^.*anvil$/,
  // Redstone
  /^(lever|repeater|comparator|daylight_detector|observer|note_block|jukebox|bell)$/,
  // Buttons
  /^.*button$/,
  // Doors, gates and trapdoors
  /^.*door$/,
  /^.*trapdoor$/,
  /^.*fence_gate$/,
  // Functional blocks
  /^(enchanting_table|lectern|composter|respawn_anchor|lodestone|conduit)$/,
  /^.*bee.*$/,
  // Beds
  /^.*bed$/,
  // Technical blocks
  /^(command_block|jigsaw|structure_block|moving_piston)$/,
  // Plants and natural blocks
  /^(dragon_egg|flower_pot|sweet_berry_bush|cave_vines.*|.*candle.*)$/,
  // Misc
  /^(cake|decorated_pot|crafter|trial_spawner|vault)$/,
  // fence (ignore)
  // sign (ignore)
] as const

export function isBlockActivatable(blockName: string): boolean {
  return activatableBlockWithoutItemPatterns.some(pattern => pattern.test(blockName))
}

export function isItemActivatable(itemName: string): boolean {
  return activatableItems.includes(itemName as any)
}
