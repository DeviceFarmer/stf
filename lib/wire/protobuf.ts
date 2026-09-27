import protobuf from 'protobufjs'

interface BuiltMessage {
  [field: string]: unknown
  encode(): Buffer
  encodeNB(): Buffer
}

interface BuiltMessageClass {
  new(...values: unknown[]): BuiltMessage
  decode(buffer: Uint8Array): BuiltMessage
  prototype: BuiltMessage
}

type FieldMap = {[name: string]: unknown}

interface ExportedNamespace {
  [name: string]: BuiltMessageClass | {[name: string]: number} | ExportedNamespace
}

function load(file: string) {
  var root = new protobuf.Root().loadSync(file, {keepCase: true})
  root.resolveAll()
  return root
}

function build(root: protobuf.NamespaceBase) {
  var classes: {[fullName: string]: BuiltMessageClass} = {}

  function toFieldValue(field: protobuf.Field, value: unknown) {
    if (typeof value === 'string' &&
        field.resolvedType instanceof protobuf.Enum &&
        Object.prototype.hasOwnProperty.call(field.resolvedType.values, value)) {
      return field.resolvedType.values[value]
    }
    return value
  }

  function isFieldMap(values: unknown, Message: Function): values is FieldMap {
    return values !== null &&
      typeof values === 'object' &&
      (typeof (values as FieldMap).encode !== 'function' || values instanceof Message) &&
      !Array.isArray(values) &&
      !Buffer.isBuffer(values)
  }

  function adopt(type: protobuf.Type, decoded: FieldMap): BuiltMessage {
    var message: BuiltMessage = Object.create(classes[type.fullName]!.prototype)
    type.fieldsArray.forEach(function(field) {
      var value = decoded[field.name]
      var isMessage = field.resolvedType instanceof protobuf.Type
      if (field.repeated) {
        message[field.name] = ((value || []) as FieldMap[]).map(function(item) {
          return isMessage ? adopt(field.resolvedType as protobuf.Type, item) : item
        })
      }
      else if (value === null ||
          typeof value === 'undefined' ||
          !Object.prototype.hasOwnProperty.call(decoded, field.name)) {
        message[field.name] = null
      }
      else {
        message[field.name] = isMessage ? adopt(field.resolvedType as protobuf.Type, value as
          FieldMap) : value
      }
    })
    return message
  }

  function createClass(type: protobuf.Type) {
    var fields = type.fieldsArray

    function Message(this: BuiltMessage, values?: unknown) {
      var that = this
      var index: number
      fields.forEach(function(field) {
        that[field.name] = field.repeated ? [] : null
      })
      if (arguments.length === 1 && isFieldMap(values, Message)) {
        Object.keys(values).forEach(function(name) {
          if (!type.fields[name]) {
            throw new Error(type.fullName + '#' + name + ' is not a field')
          }
          that[name] = toFieldValue(type.fields[name], values[name])
        })
      }
      else {
        for (index = 0; index < arguments.length; index++) {
          if (typeof arguments[index] !== 'undefined') {
            if (!fields[index]) {
              throw new Error(type.fullName + ' has no field in position ' + (index + 1))
            }
            that[fields[index]!.name] = toFieldValue(fields[index]!, arguments[index])
          }
        }
      }
    }

    Message.prototype.encode = function(this: BuiltMessage) {
      var invalid = type.verify(this)
      if (invalid) {
        throw new Error(type.fullName + ': ' + invalid)
      }
      var encoded = type.encode(this).finish()
      return Buffer.isBuffer(encoded) ? encoded : Buffer.from(encoded)
    }

    Message.prototype.encodeNB = Message.prototype.encode

    Message.decode = function(buffer: Uint8Array) {
      return adopt(type, type.decode(buffer))
    }

    return Message as unknown as BuiltMessageClass
  }

  function eachType(
    namespace: protobuf.NamespaceBase
  , handler: (type: protobuf.Type) => void
  ) {
    namespace.nestedArray.forEach(function(nested) {
      if (nested instanceof protobuf.Type) {
        handler(nested)
        eachType(nested, handler)
      }
      else if (nested instanceof protobuf.Namespace) {
        eachType(nested, handler)
      }
    })
  }

  function exportNamespace(namespace: protobuf.NamespaceBase) {
    var exported: ExportedNamespace = {}
    namespace.nestedArray.forEach(function(nested) {
      if (nested instanceof protobuf.Type) {
        exported[nested.name] = classes[nested.fullName]!
      }
      else if (nested instanceof protobuf.Enum) {
        exported[nested.name] = Object.assign({}, nested.values)
      }
      else if (nested instanceof protobuf.Namespace) {
        exported[nested.name] = exportNamespace(nested)
      }
    })
    return exported
  }

  eachType(root, function(type) {
    classes[type.fullName] = createClass(type)
  })

  return exportNamespace(root)
}

export default {load, build}
