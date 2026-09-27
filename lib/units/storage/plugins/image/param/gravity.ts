var GRAVITY = {
  northwest: 'NorthWest'
, north: 'North'
, northeast: 'NorthEast'
, west: 'West'
, center: 'Center'
, east: 'East'
, southwest: 'SouthWest'
, south: 'South'
, southeast: 'SouthEast'
}

export default function(raw: string | undefined) {
  var parsed

  if (raw && (parsed = GRAVITY[raw as keyof typeof GRAVITY])) {
    return parsed
  }

  return null
}
