# nice-tabs

This are nice tabs. They wrap:
- Angular Bootstrap tabs
- Feature Font Awesome icon support
- Load and preload templates for each tab
- Save last selected tab to localForage
- Support tab show/hide (?)





### Current syntax
```html
<nice-tabs key='ControlBottomTabs' direction='below' tabs='tabs'></nice-tabs>
```

```javascript
function Ctrl($scope) {
	$scope.tabs = [
    	{title: 'Tab One', icon: 'fa-bolt', templateUrl='terminal/tab-one.jade'},
    	{title: 'Tab One', icon: 'fa-bolt', templateUrl='terminal/tab-one.jade'},
	]
}
```
