describe('textFocusSelect', function() {
  beforeEach(angular.mock.module(require('./').name))

  var scope, compile, element

  beforeEach(inject(function($rootScope, $compile) {
    scope = $rootScope.$new()
    compile = $compile
  }))

  afterEach(function() {
    if (element) {
      element.remove()
      element = null
    }
  })

  // focus and mouse events only behave like the browser once the node is in the document
  function build(html) {
    element = compile(html)(scope)
    document.body.appendChild(element[0])
    scope.$digest()
    return element[0]
  }

  function input() {
    return build('<input text-focus-select value="ssh-rsa AAAAB3">')
  }

  function fire(node, type) {
    node.dispatchEvent(new MouseEvent(type, {bubbles: true, cancelable: true}))
  }

  // the tail of a real click, in the order the browser sends it
  function releaseClick(node) {
    fire(node, 'mouseup')
    fire(node, 'click')
  }

  function selection(node) {
    return [node.selectionStart, node.selectionEnd]
  }

  it('should put the selection back after a focusing click collapses it', function() {
    var node = input()

    node.focus()
    node.setSelectionRange(3, 3)
    releaseClick(node)

    expect(selection(node)).toEqual([0, node.value.length])
  })

  it('should do the same for a readonly textarea', function() {
    var tip = 'pbcopy &lt; ~/.android/adbkey.pub'
    var node = build('<textarea text-focus-select readonly>' + tip + '</textarea>')

    node.focus()
    node.setSelectionRange(3, 3)
    releaseClick(node)

    expect(selection(node)).toEqual([0, node.value.length])
  })

  it('should leave a range the user dragged out alone', function() {
    var node = input()

    node.focus()
    node.setSelectionRange(2, 5)
    releaseClick(node)

    expect(selection(node)).toEqual([2, 5])
  })

  it('should let a click on an already focused field place the caret', function() {
    var node = input()

    node.focus()
    releaseClick(node)
    node.setSelectionRange(4, 4)
    releaseClick(node)

    expect(selection(node)).toEqual([4, 4])
  })

  // a drag that starts elsewhere and is released over the field blurs it on
  // mousedown, so the mouseup lands with no focus of its own to act on
  it('should keep out of a field that lost focus before the mouse came up', function() {
    var node = input()

    node.focus()
    node.blur()
    node.setSelectionRange(3, 3)
    fire(node, 'mouseup')

    expect(selection(node)).toEqual([3, 3])
  })
})
