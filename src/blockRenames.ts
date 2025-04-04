import itemBlockRenames from './itemBlockRenames.json'
import { versionToNumber } from './utils'

// postflatenning
// todo regen 1.13 the flatenning data

// const allRenamesMapFromLatest = Object.fromEntries(
//   ['blocks', 'items'].map(x =>
//     [
//       x,
//       Object.fromEntries(Object.entries(itemBlockRenames).flatMap(([ver, t]) => t[x]?.map(([oldName, newName]) => [
//         newName,
//         { version: versionToNumber(ver), oldName }
//       ])).filter(x => x))
//     ])
// ) as { [thing: string]: Record<string, { version: number, oldName: string }> }

export const getRenamedData = (type: 'blocks' | 'items', blockOrItem: string | string[], versionFrom: string, versionTo: string) => {
  const verFrom = versionToNumber(versionFrom)
  const verTo = versionToNumber(versionTo)
  const dir = verFrom < verTo ? 1 : -1
  const targetIdx = dir > 0 ? 1 : 0
  let renamed = blockOrItem
  const mapVersions = Object.keys(itemBlockRenames).sort((a, b) => dir * (versionToNumber(a) - versionToNumber(b)))
  const upperBoundVer = dir > 0 ? verTo : verFrom
  const lowerBoundVer = dir > 0 ? verFrom : verTo
  for (const mapVersion of mapVersions.filter(x => versionToNumber(x) <= upperBoundVer && versionToNumber(x) >= lowerBoundVer)) {
    if (dir > 0 && versionToNumber(mapVersion) >= upperBoundVer) break
    if (dir < 0 && versionToNumber(mapVersion) <= lowerBoundVer) break
    const nextMapData = itemBlockRenames[mapVersion][type]
    if (!nextMapData) continue
    for (const namesArr of nextMapData) {
      const targetName = namesArr[targetIdx]
      const compareName = namesArr[1 - targetIdx]
      if (Array.isArray(renamed)) {
        if (renamed.includes(compareName)) renamed = renamed.map(x => x === compareName ? targetName : x)
      } else if (renamed === compareName) {
        renamed = targetName
        break
      }
    }
  }
  return renamed
}
