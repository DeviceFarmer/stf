module.exports = function textFocusSelectDirective() {
  return {
    restrict: 'AC'
    , link: function(scope, element) {
      var selectOnMouseUp = false

      element.bind('focus', function() {
        selectOnMouseUp = true
        this.select()
      })

      // a focusing click collapses what focus just selected, so redo it, unless the user dragged out a range of their own
      element.bind('mouseup', function() {
        if (selectOnMouseUp) {
          selectOnMouseUp = false
          if (this.selectionStart === this.selectionEnd) {
            this.select()
          }
        }
      })

      element.bind('blur', function() {
        selectOnMouseUp = false
      })
    }
  }
}
