export const versionToNumber = (ver: string) => {
    const [x, y = '0', z = '0'] = ver.split('.')
    return +`${x!.padStart(2, '0')}${(parseInt(y).toString().padStart(2, '0'))}${parseInt(z).toString().padStart(2, '0')}`
}
