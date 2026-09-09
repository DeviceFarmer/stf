var protobuf = require('protobufjs')

function load(file) {
  var root = new protobuf.Root().loadSync(file, {keepCase: true})
  root.resolveAll()
  return root
}

function build(root) {
  var classes = {}

  function toFieldValue(field, value) {
    if (typeof value === 'string' &&
        field.resolvedType instanceof protobuf.Enum &&
        Object.prototype.hasOwnProperty.call(field.resolvedType.values, value)) {
      return field.resolvedType.values[value]
    }
    return value
  }

  function isFieldMap(values, Message) {
    return values !== null &&
      typeof values === 'object' &&
      (typeof values.encode !== 'function' || values instanceof Message) &&
      !Array.isArray(values) &&
      !Buffer.isBuffer(values)
  }

  function adopt(type, decoded) {
    var message = Object.create(classes[type.fullName].prototype)
    type.fieldsArray.forEach(function(field) {
      var value = decoded[field.name]
      var isMessage = field.resolvedType instanceof protobuf.Type
      if (field.repeated) {
        message[field.name] = (value || []).map(function(item) {
          return isMessage ? adopt(field.resolvedType, item) : item
        })
      }
      else if (value === null ||
          typeof value === 'undefined' ||
          !Object.prototype.hasOwnProperty.call(decoded, field.name)) {
        message[field.name] = null
      }
      else {
        message[field.name] = isMessage ? adopt(field.resolvedType, value) : value
      }
    })
    return message
  }

  function createClass(type) {
    var fields = type.fieldsArray

    function Message(values) {
      var that = this
      var index
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
            that[fields[index].name] = toFieldValue(fields[index], arguments[index])
          }
        }
      }
    }

    Message.prototype.encode = function() {
      var invalid = type.verify(this)
      if (invalid) {
        throw new Error(type.fullName + ': ' + invalid)
      }
      var encoded = type.encode(this).finish()
      return Buffer.isBuffer(encoded) ? encoded : Buffer.from(encoded)
    }

    Message.prototype.encodeNB = Message.prototype.encode

    Message.decode = function(buffer) {
      return adopt(type, type.decode(buffer))
    }

    return Message
  }

  function eachType(namespace, handler) {
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

  function exportNamespace(namespace) {
    var exported = {}
    namespace.nestedArray.forEach(function(nested) {
      if (nested instanceof protobuf.Type) {
        exported[nested.name] = classes[nested.fullName]
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

module.exports.load = load
module.exports.build = build
