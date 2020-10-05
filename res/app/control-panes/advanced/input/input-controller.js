import MicroModal from 'micromodal';//require('micromodal');
import DomCascade from 'dom-cascade';
import MinLib from 'minlib';

export default function InputCtrl($scope) {
  $scope.press = function(key) {
    $scope.control.keyPress(key)
  }
  
  $scope.handle_alert = function() {
    MicroModal.init();
    
    var dc = new DomCascade();
    var ml = new MinLib();
    
    $scope.control.getAlertInfo().then( function( arr ) {
      //<button class="modal__btn modal__btn-primary">Continue</button>
      //    <button class="modal__btn" data-micromodal-close aria-label="Close this dialog window">Close</button>
          
      var text = arr[0].body.value;
      var parts = text.split('\n');
      var title = parts.shift();
      ml.gel('alertModal-title').innerHTML = title;
      
      var dcParts = [];
      for( var i=0;i<parts.length;i++ ) {
          dcParts.push( { name: 'text', text: parts[i] } );
          if( i != ( parts.length - 1 ) ) dcParts.push( { name: 'br' } );
      }
      if( dcParts.length ) dc.replaceInner( ml.gel('alertModal-content'), dcParts );
      
      var btns = arr[1].body.value;
      var dcCode = [];
      for( var i=0;i<btns.length;i++ ) {
        var btn = btns[i];
        dcCode.push( {
          name: 'button',
          class: ( (i==0) ? 'modal__btn modal__btn-primary' : 'modal__btn' ),
          attr: { 'data-micromodal-close': 1, 'data-text': btn },
          sub: { name: 'text', text: btn }
        } );
      }
      dc.replaceInner( ml.gel('alertModal-footer'), dcCode );
      
      MicroModal.show('alertModal', {
        onClose: function( a, b, event ) {
            var btn = event.originalTarget;
            var btnText = btn.getAttribute('data-text')
            console.log( btnText );
            $scope.control.alertAccept( btnText );
        }
      });
      
    } );
  }
}
