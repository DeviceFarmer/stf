interface CatalogDevice {
  platform: string
  manufacturers: string[]
  models: string[]
  products?: string[]
  name: string
  image: string
}

export const deviceCatalog: CatalogDevice[] = [
  {
    platform: 'ios', manufacturers: ['apple'], models: ['iphone17,4']
  , name: 'iPhone 16 Plus', image: 'iphone-16-plus-v2.webp'
  }
, {
    platform: 'ios', manufacturers: ['apple'], models: ['iphone14,2']
  , name: 'iPhone 13 Pro', image: 'iphone-13-pro-v2.webp'
  }
, {
    platform: 'ios', manufacturers: ['apple'], models: ['iphone14,8']
  , name: 'iPhone 14 Plus', image: 'iphone-14-plus-v2.webp'
  }
, {
    platform: 'android', manufacturers: ['samsung'], models: ['sm-a556e']
  , name: 'Galaxy A55 5G', image: 'galaxy-a55-v2.webp'
  }
, {
    platform: 'android', manufacturers: ['samsung'], models: ['sm-f936b']
  , name: 'Galaxy Z Fold4', image: 'galaxy-z-fold4-v2.webp'
  }
, {
    platform: 'android', manufacturers: ['xiaomi'], models: ['mi a2']
  , name: 'Mi A2', image: 'mi-a2-v2.webp'
  }
, {
    platform: 'android', manufacturers: ['xiaomi', 'redmi'], models: ['23124ra7eo']
  , products: ['sapphiren'], name: 'Redmi Note 13', image: 'redmi-note-13-v2.webp'
  }
, {
    platform: 'android', manufacturers: ['huawei'], models: ['ctr-l81']
  , products: ['hwctrn-q'], name: 'Huawei nova 12i', image: 'huawei-nova-12i-v2.webp'
  }
]

export function findCatalogDevice(device: {
  platform?: string | null
  manufacturer?: string | null
  model?: string | null
  product?: string | null
}): CatalogDevice | undefined {
  const platform = device.platform?.trim().toLowerCase()
  const manufacturer = device.manufacturer?.trim().toLowerCase()
  const model = device.model?.trim().toLowerCase()
  const product = device.product?.trim().toLowerCase()
  return deviceCatalog.find(entry =>
    (!platform || entry.platform === platform) &&
    (!manufacturer || entry.manufacturers.includes(manufacturer)) &&
    ((!!model && entry.models.includes(model)) || (!!product && entry.products?.includes(product))))
}
