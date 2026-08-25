/**
* Copyright © 2019 code initially contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

describe('DevicesCtrl', function() {
  beforeEach(angular.mock.module(require('./index').name))

  var scope

  beforeEach(inject(function($rootScope, $controller) {
    scope = $rootScope.$new()
    $controller('DevicesCtrl', {$scope: scope})
  }))

  it('should ...', inject(function() {
    expect(1).toEqual(1)
  }))
})
