var FileSaver = require('file-saver')

describe('SaveLogService', function() {
  beforeEach(angular.mock.module(require('./').name))

  var service, modal, controller, rootScope, capturedCtrl

  var fakeDevice = [
    {
      date: '01-01 00:00:00.000'
      , pid: '1234'
      , tag: 'ActivityManager'
      , priorityLabel: 'I'
      , message: 'first line'
      , deviceLabel: 'Android'
      , serial: 'serial-1'
    }
    , {
      date: '01-01 00:00:01.000'
      , pid: '1235'
      , tag: 'Zygote'
      , priorityLabel: 'W'
      , message: 'second line'
    }
    , {
      date: '01-01 00:00:02.000'
      , pid: '1236'
      , tag: 'WindowManager'
      , priorityLabel: 'E'
      , message: 'third line'
    }
    , {
      date: '01-01 00:00:03.000'
      , pid: '1237'
      , tag: 'PackageManager'
      , priorityLabel: 'D'
      , message: 'fourth line'
    }
  ]

  beforeEach(inject(function(SaveLogService, $uibModal, $controller, $rootScope) {
    service = SaveLogService
    modal = $uibModal
    controller = $controller
    rootScope = $rootScope

    spyOn(modal, 'open').and.returnValue({result: {then: angular.noop}})
    spyOn(FileSaver, 'saveAs')

    service.open(fakeDevice, false)
    capturedCtrl = modal.open.calls.mostRecent().args[0].controller
  }))

  function openModal(device) {
    var scope = rootScope.$new()
    controller(capturedCtrl, {
      $scope: scope
      , $uibModalInstance: {
        close: jasmine.createSpy('close')
        , dismiss: jasmine.createSpy('dismiss')
      }
      , device: device || fakeDevice
    })
    scope.$digest()
    return scope
  }

  function lastSave() {
    return FileSaver.saveAs.calls.mostRecent().args
  }

  it('should reset a reopened modal to the format its dropdown shows', function() {
    var first = openModal()
    first.selectedExtension = 'log'
    first.$digest()
    first.saveLogs()

    var second = openModal()
    second.saveLogs()

    expect(second.selectedExtension).toEqual('json')
    expect(lastSave()[0].type).toEqual('application/json;charset=utf-8')
    expect(lastSave()[1]).toMatch(/\.json$/)
  })

  it('should save plain text when the log format is chosen', function() {
    var scope = openModal()
    scope.selectedExtension = 'log'
    scope.$digest()
    scope.saveLogs()

    expect(lastSave()[0].type).toEqual('text/plain;charset=utf-8')
    expect(lastSave()[1]).toMatch(/\.log$/)
  })

  it('should preview a log shorter than the sample line count', function() {
    var scope = openModal(fakeDevice.slice(0, 2))

    expect(JSON.parse(scope.samplePresentation).logs.length).toEqual(2)

    scope.selectedExtension = 'log'
    scope.$digest()

    expect(scope.samplePresentation.split('\n').filter(Boolean).length).toEqual(2)
  })

  it('should append the chosen extension to a custom file name', function() {
    var scope = openModal()
    scope.saveLogFileName = 'my-logs'
    scope.selectedExtension = 'log'
    scope.$digest()
    scope.saveLogs()

    expect(lastSave()[1]).toEqual('my-logs.log')
  })
})
