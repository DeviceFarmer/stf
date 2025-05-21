describe('Menu', function() {
  it('should display the STF version', function() {
    // Navigate to the device list page
    browser.get('/#!/devices')

    // Find the version display element
    var versionElement = element(by.css('.stf-menu .version-text'))

    // Assert that the element is present
    expect(versionElement.isPresent()).toBe(true)

    // Assert that the text matches 'v' + version from package.json
    // Using a regex to be more flexible with the exact version number.
    expect(versionElement.getText()).toMatch(/^v\d+\.\d+\.\d+$/)
  })
})
