'use strict'

const Promise = require('bluebird')
var bplist = require('bplist')
var plist = require('plist')
var fs = require('fs')
var unzipper = require('unzipper')
var os = require('os')
var util = require('util')
var execSync = require('child_process').execSync;
var EventEmitter = require('eventemitter3')
var logger = require('./logger')
var log = logger.createLogger('util:ipareader')

function IpaReader(filepath) {
  EventEmitter.call(this)
  this.file = filepath
  this.cachedir = os.tmpdir()+'/ipa'
}

util.inherits(IpaReader, EventEmitter)

IpaReader.prototype.parsePlist = function(){
  var manifest = {}
  
  var destdir = this.cachedir+'/Payload'
  var dirs = fs.readdirSync(destdir)
  destdir = util.format("%s/%s",destdir,dirs[0])
  var destfile = destdir+'/Info.plist'
  var content = fs.readFileSync(destfile)
  return new Promise((resolve,reject)=>{
    var process = function(err,result){
      if(err){
        return reject(err)
      }
      manifest = result[0]
      manifest.package = result[0].CFBundleIdentifier
      manifest.versionCode = parseInt(result[0].CFBundleInfoDictionaryVersion)
      manifest.versionName = result[0].CFBundleShortVersionString
      return resolve(manifest) 
    };
    
    console.log( typeof( content ) );
    var firstSix = content.toString( 'ascii', 0, 6 );
    if( firstSix == "bplist" ) {
      bplist.parseBuffer( content, process )
    }
    else {
      var data = plist.parse( content.toString('utf-8') );
      process( 0, [data] );
    }
  } )
}

IpaReader.prototype.UnzipIpa = function(){
    this.cachedir = os.tmpdir()+'/ipa'
    if(fs.existsSync(this.cachedir)){
    var cmd = 'rm -rf '+this.cachedir
      console.log(cmd)
      execSync(cmd,{});
    }
    fs.mkdirSync(this.cachedir)

    log.info("Extracting " + this.file + " to " + this.cachedir );
    
    return new Promise((resolve,reject)=>{
      var extractor = unzipper.Extract({
        path: this.cachedir
      });
      extractor.on('error', function(err) {
        throw err;
      });
      extractor.promise().then(function() {
        return resolve()
      });
      fs.createReadStream( this.file ).pipe( extractor )        
    })
}

IpaReader.prototype.ReadInfoPlist = function(){
  return new Promise((resolve,reject)=>{
    this.UnzipIpa().then(()=>{
      this.parsePlist().then(function(res){
        return resolve(res)
      })
    })
  })
}

module.exports = IpaReader