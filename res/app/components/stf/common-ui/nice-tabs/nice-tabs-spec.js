describe('niceTabs', function() {
  beforeEach(angular.mock.module(require('./').name))

  it('should ...', function() {

    /*
     To test your directive, you need to create some html that would use your directive,
     send that through compile() then compare the results.

     var element = compile('<div nice-tabs name="name">hi</div>')(scope);
     expect(element.text()).toBe('hello, world');
     */

  })

  it('should not register a singular niceTab directive', inject(function($injector) {
    expect($injector.has('niceTabDirective')).toBe(false)
  }))

  it('should register the niceTabs directive', inject(function($injector) {
    expect($injector.has('niceTabsDirective')).toBe(true)
  }))

  describe('remembering the selected tab', function() {
    var TOP = '<nice-tabs key="ControlTopTabs" tabs="tabs" filter="platform"></nice-tabs>'
    var UNKEYED = '<nice-tabs tabs="tabs" filter="platform"></nice-tabs>'
    var PANES =
      '<div>' +
      '<div fa-pane pane-id="control-bottom-tabs" pane-anchor="south">' +
      '<nice-tabs key="ControlBottomTabs" tabs="belowTabs" filter="platform"></nice-tabs>' +
      '</div>' +
      '<div fa-pane pane-id="control-top-tabs" pane-anchor="">' +
      '<nice-tabs key="ControlTopTabs" tabs="topTabs" filter="platform"></nice-tabs>' +
      '</div>' +
      '</div>'

    beforeEach(angular.mock.module(require('stf/settings').name))
    beforeEach(angular.mock.module(require('ui-bootstrap').name))
    beforeEach(angular.mock.module(require('angular-borderlayout').name))
    beforeEach(angular.mock.module(require('gettext').name))

    var rootScope, compile, socket

    function bootstrap(stored) {
      angular.mock.module(function(AppStateProvider) {
        AppStateProvider.set({user: {settings: stored}})
      })
      inject(function($rootScope, $compile, _socket_) {
        rootScope = $rootScope
        compile = $compile
        socket = _socket_
        spyOn(socket, 'emit')
      })
    }

    function topTabs() {
      return [
        {title: 'Dashboard', filters: ['native', 'web']}
        , {title: 'Screenshots', filters: ['native', 'web']}
        , {title: 'Logs', filters: ['native']}
      ]
    }

    function belowTabs() {
      return [
        {title: 'Console', filters: ['native', 'web']}
        , {title: 'Info', filters: ['native', 'web']}
      ]
    }

    function scopeWith(properties) {
      var scope = rootScope.$new()

      return angular.extend(scope, properties)
    }

    function render(markup, scope) {
      var element = compile(markup)(scope)

      rootScope.$digest()
      return element
    }

    function headings(element) {
      return Array.prototype.map.call(element.find('li'), function(item) {
        return angular.element(item).text().trim()
      })
    }

    function activeHeadings(element) {
      return Array.prototype.map.call(element.find('ul'), function(list) {
        var active = null

        angular.forEach(angular.element(list).find('li'), function(item) {
          if (angular.element(item).hasClass('active')) {
            active = angular.element(item).text().trim()
          }
        })
        return active
      })
    }

    function click(element, heading) {
      angular.forEach(element.find('li'), function(item) {
        if (angular.element(item).text().trim() === heading) {
          angular.element(item).find('a').triggerHandler('click')
        }
      })
      rootScope.$digest()
    }

    function settingsUpdates() {
      return socket.emit.calls.allArgs()
        .filter(function(args) {
          return args[0] === 'user.settings.update'
        })
        .map(function(args) {
          return args[1]
        })
    }

    it('should restore the tab remembered under its key', function() {
      bootstrap({ControlTopTabs: 'Screenshots'})
      var element = render(TOP, scopeWith({tabs: topTabs(), platform: 'native'}))

      expect(headings(element)).toEqual(['Dashboard', 'Screenshots', 'Logs'])
      expect(activeHeadings(element)).toEqual(['Screenshots'])
      expect(settingsUpdates()).toEqual([])
    })

    it('should remember the tab the user selects', function() {
      bootstrap({})
      var element = render(TOP, scopeWith({tabs: topTabs(), platform: 'native'}))

      click(element, 'Logs')

      expect(activeHeadings(element)).toEqual(['Logs'])
      expect(settingsUpdates().length).toBe(1)
      expect(settingsUpdates()[0].ControlTopTabs).toBe('Logs')
    })

    it('should not write anything for the tab the tabset picks on its own', function() {
      bootstrap({})
      var element = render(TOP, scopeWith({tabs: topTabs(), platform: 'native'}))

      expect(activeHeadings(element)).toEqual(['Dashboard'])
      expect(settingsUpdates()).toEqual([])
    })

    it('should keep two tabsets with different keys apart', function() {
      bootstrap({ControlTopTabs: 'Screenshots', ControlBottomTabs: 'Info'})
      var scope = scopeWith({
        topTabs: topTabs(), belowTabs: belowTabs(), platform: 'native'
      })
      var element = render(PANES, scope)

      expect(activeHeadings(element)).toEqual(['Info', 'Screenshots'])
      expect(settingsUpdates()).toEqual([])

      click(element, 'Logs')

      expect(activeHeadings(element)).toEqual(['Info', 'Logs'])
      expect(settingsUpdates().length).toBe(1)
      expect(settingsUpdates()[0].ControlTopTabs).toBe('Logs')
    })

    it('should fall back to the first tab when the remembered tab is filtered out', function() {
      bootstrap({ControlTopTabs: 'Logs'})
      var element = render(TOP, scopeWith({tabs: topTabs(), platform: 'web'}))

      expect(activeHeadings(element)).toEqual(['Dashboard'])
      expect(settingsUpdates()).toEqual([])

      click(element, 'Screenshots')

      expect(settingsUpdates().length).toBe(1)
      expect(settingsUpdates()[0].ControlTopTabs).toBe('Screenshots')
    })

    it('should fall back to the first tab when the remembered tab is gone', function() {
      bootstrap({ControlTopTabs: 'Retired'})
      var element = render(TOP, scopeWith({tabs: topTabs(), platform: 'native'}))

      expect(activeHeadings(element)).toEqual(['Dashboard'])
      expect(settingsUpdates()).toEqual([])

      click(element, 'Screenshots')

      expect(settingsUpdates().length).toBe(1)
      expect(settingsUpdates()[0].ControlTopTabs).toBe('Screenshots')
    })

    it('should restore once the filter it depends on arrives', function() {
      bootstrap({ControlTopTabs: 'Logs'})
      var scope = scopeWith({tabs: topTabs()})
      var element = render(TOP, scope)

      expect(activeHeadings(element)).toEqual(['Dashboard'])

      scope.platform = 'native'
      rootScope.$digest()

      expect(activeHeadings(element)).toEqual(['Logs'])
      expect(settingsUpdates()).toEqual([])
    })

    it('should leave settings alone for a tabset without a key', function() {
      bootstrap({})
      var element = render(UNKEYED, scopeWith({tabs: topTabs(), platform: 'native'}))

      click(element, 'Logs')

      expect(activeHeadings(element)).toEqual(['Logs'])
      expect(settingsUpdates()).toEqual([])
    })
  })

  describe('direction', function() {
    var BELOW = '<nice-tabs direction="below" tabs="tabs"></nice-tabs>'
    var PLAIN = '<nice-tabs tabs="tabs"></nice-tabs>'
    var SIDEWAYS = '<nice-tabs direction="sideways" tabs="tabs"></nice-tabs>'
    var FIXTURE = 'nice-tabs-direction-fixture.pug'

    beforeEach(angular.mock.module(require('stf/settings').name))
    beforeEach(angular.mock.module(require('ui-bootstrap').name))
    beforeEach(angular.mock.module(require('gettext').name))

    var rootScope, compile, pane, hosts

    beforeEach(inject(function($rootScope, $compile, $templateCache) {
      rootScope = $rootScope
      compile = $compile
      hosts = []
      $templateCache.put(FIXTURE, '<div style="height: 60px">content</div>')
    }))

    afterEach(function() {
      angular.forEach(hosts, function(host) {
        host.remove()
      })
    })

    function render(markup) {
      var scope = rootScope.$new()

      scope.tabs = [
        {title: 'One', templateUrl: FIXTURE}
        , {title: 'Two', templateUrl: FIXTURE}
      ]

      var host = angular.element(
        '<div style="position: relative; width: 600px; height: 300px">' +
        '<div style="position: absolute; top: 0; right: 0; bottom: 0; left: 0">' +
        '</div></div>'
      )
      var element = compile(markup)(scope)

      pane = angular.element(host.children()[0])
      pane.append(element)
      angular.element(document.body).append(host)
      hosts.push(host)
      rootScope.$digest()
      return element
    }

    function styleOf(element, selector) {
      return window.getComputedStyle(element[0].querySelector(selector))
    }

    function boxOf(element, selector) {
      return element[0].querySelector(selector).getBoundingClientRect()
    }

    function topOf(element, selector) {
      return boxOf(element, selector).top
    }

    function tabsetStyle(element) {
      return window.getComputedStyle(element.children()[0])
    }

    it('should put the tab strip under the content for direction below', function() {
      var element = render(BELOW)

      expect(element.hasClass('tabs-below')).toBe(true)
      expect(tabsetStyle(element).display).toBe('flex')
      expect(tabsetStyle(element).flexDirection).toBe('column-reverse')
      expect(topOf(element, '.nav-tabs'))
        .toBeGreaterThan(topOf(element, '.tab-content'))
    })

    it('should fill the pane so the strip lands on its bottom edge', function() {
      var element = render(BELOW)
      var tabset = element.children()[0].getBoundingClientRect()
      var bounds = pane[0].getBoundingClientRect()
      var strip = boxOf(element, '.nav-tabs')
      var content = boxOf(element, '.tab-content')

      expect(Math.round(tabset.top)).toBe(Math.round(bounds.top))
      expect(Math.round(tabset.bottom)).toBe(Math.round(bounds.bottom))
      expect(strip.height).toBeGreaterThan(0)
      expect(strip.top).toBeGreaterThan(content.bottom - 1)
      expect(strip.bottom).toBeLessThan(bounds.bottom + 1)
    })

    it('should keep the content inside the pane it is given', function() {
      var element = render(BELOW)

      expect(styleOf(element, '.tab-content').overflow).toBe('auto')
      expect(boxOf(element, '.tab-content').height)
        .toBeLessThan(pane[0].getBoundingClientRect().height)
    })

    it('should leave nested tabsets in their default layout',
      inject(function($templateCache) {
        $templateCache.put(FIXTURE,
          '<uib-tabset><uib-tab heading="Results">Result</uib-tab>' +
          '<uib-tab heading="Raw">Raw result</uib-tab></uib-tabset>'
        )
        var element = render(BELOW)
        var strip = styleOf(element, '.tab-content .nav-tabs')
        var content = styleOf(element, '.tab-content .tab-content')

        expect(strip.borderTopWidth).toBe('0px')
        expect(content.position).toBe('static')
        expect(content.overflow).toBe('visible')
      }))

    it('should join the active tab to the content from underneath', function() {
      var element = render(BELOW)
      var strip = styleOf(element, '.nav-tabs')
      var active = styleOf(element, '.nav-tabs > li.active > a')

      expect(strip.borderTopWidth).toBe('1px')
      expect(strip.borderBottomWidth).toBe('0px')
      expect(active.borderTopColor).toBe('rgba(0, 0, 0, 0)')
      expect(active.borderBottomColor).toBe('rgb(221, 221, 221)')
    })

    it('should leave the tab strip above the content with no direction', function() {
      var element = render(PLAIN)

      expect(element.hasClass('tabs-below')).toBe(false)
      expect(tabsetStyle(element).display).toBe('block')
      expect(styleOf(element, '.nav-tabs').borderTopWidth).toBe('0px')
      expect(topOf(element, '.nav-tabs'))
        .toBeLessThan(topOf(element, '.tab-content'))
    })

    it('should leave the tab strip above the content for any other direction',
      function() {
        var element = render(SIDEWAYS)

        expect(element.hasClass('tabs-below')).toBe(false)
        expect(tabsetStyle(element).display).toBe('block')
        expect(styleOf(element, '.nav-tabs').borderTopWidth).toBe('0px')
        expect(topOf(element, '.nav-tabs'))
          .toBeLessThan(topOf(element, '.tab-content'))
      })
  })
})
