# nice-tabs

This are nice tabs. They wrap:
- Angular Bootstrap tabs
- Feature Font Awesome icon support
- Load and preload templates for each tab
- Save the last selected tab through SettingsService using the `key` attribute
- Place the tab strip below the content with `direction='below'`
- Support tab show/hide (?)





### Current syntax

Use a distinct `key` for each tabset. `direction='below'` expects a positioned container with a fixed height.

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
