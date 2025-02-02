'use strict';

var libQ = require('kew');
var fs=require('fs-extra');
var config = new (require('v-conf'))();
var exec = require('child_process').exec;
var execSync = require('child_process').execSync;
var sizeOf = require('image-size');
var use_SDL2 = false;

const lineReader = require('line-reader');
const io = require('socket.io-client');
const socket = io.connect('http://localhost:3000');
const path = require('path');
const ini = require('ini');
//---
const id = 'peppy_screensaver: ';      // for logging
const PluginPath = '/data/plugins/user_interface/peppy_screensaver';
const runFlag = '/tmp/peppyrunning';   // for detection, if peppymeter always running
//---
var PeppyPath = PluginPath + '/screensaver/peppymeter';
var RunPeppyFile = PluginPath + '/run_peppymeter.sh';
var PeppyConf = PeppyPath + '/config.txt';
const meterFolderStr = 'meter.folder'; // entry in config.txt to detect template folder

var minmax = new Array(7);
var last_outputdevice, last_softmixer;
var peppy_config, base_folder_P;

const PluginConfiguration = '/data/configuration/plugins.json';
const MPDtmpl = '/volumio/app/plugins/music_service/mpd/mpd.conf.tmpl';
const MPD = '/tmp/mpd.conf.tmpl';
const MPD_include_tmpl = PluginPath + '/mpd_custom.conf';
const MPD_include = '/data/configuration/music_service/mpd/mpd_custom.conf';
const AIRtmpl = '/volumio/app/plugins/music_service/airplay_emulation/shairport-sync.conf.tmpl';
const AIR = '/tmp/shairport-sync.conf.tmpl';
const asound = '/Peppyalsa.postPeppyalsa.5.conf';

var availMeters = '';
var uiNeedsUpdate;
const spotify_config = '/data/plugins/music_service/spop/config.yml.tmpl';
const dsp_config = '/data/plugins/audio_interface/fusiondsp/camilladsp.conf.yml';
module.exports = peppyScreensaver;

// for spectrum
var SpectrumPath = PluginPath + '/screensaver/spectrum';
var SpectrumConf = SpectrumPath + '/config.txt';
//const SpectrumTmp = '/tmp/spectrumconfig.txt';
const SpectrumFolderStr = 'spectrum.folder';// entry in config.txt to detect template folder
var spectrum_config, base_folder_S;

function peppyScreensaver(context) {
	var self = this;

	self.context = context;
	self.commandRouter = self.context.coreCommand;
	self.logger = self.context.logger;
	self.configManager = self.context.configManager;
};


peppyScreensaver.prototype.onVolumioStart = function()
{
	var self = this;
	var configFile = self.commandRouter.pluginManager.getConfigurationFile(self.context,'config.json');
	self.config = new (require('v-conf'))();
	self.config.loadFile(configFile);
        
    return libQ.resolve();
};

peppyScreensaver.prototype.onStart = function() {
    var self = this;
    var defer=libQ.defer();
    var lastStateIsPlaying = false;
    var Timeout;

    // load language strings here again, otherwise needs restart after installation
    self.commandRouter.loadI18nStrings();
    
    // create fifo pipe for PeppyMeter/PeppySpectrum
    self.install_mkfifo('/tmp/myfifo');
    self.install_mkfifo('/tmp/myfifosa');
    // load snd dummy for peppymeter output 
    self.install_dummy();

    // remove old flag
    if (fs.existsSync(runFlag)){fs.removeSync(runFlag);}

    // get peppyMeter config and new baseFolder
    if (fs.existsSync(PeppyConf)){
        peppy_config = ini.parse(fs.readFileSync(PeppyConf, 'utf-8'));
        base_folder_P = peppy_config.current['base.folder'] + '/';
        if (base_folder_P == '/') {base_folder_P = PeppyPath + '/';}
    }

    // get peppySpectrum config and new baseFolder
    if (fs.existsSync(SpectrumConf)){
        spectrum_config = ini.parse(fs.readFileSync(SpectrumConf, 'utf-8'));
        base_folder_S = spectrum_config.current['base.folder'] + '/';
        if (base_folder_S == '/') {base_folder_S = SpectrumPath + '/';}
	}
	
    // copy MPD_include file and set output
    if (!fs.existsSync(MPD_include)) {self.copy_MPD_include(MPD_include_tmpl, MPD_include);}
    // only if it not correct deleted on uninstall
    var enableDSD = parseInt(self.config.get('alsaSelection'),10) == 1 ? true : false;
    self.MPD_setOutput(MPD_include, enableDSD);

    // check pygame 2 installed
    self.get_SDL2_enabled().then(function (SDL) { use_SDL2 = SDL; });
              
    if (self.IfBuster()) {
      //_________________ detect Buster _________________

      // inject additional include entry to mpd.conf, only if not exist, it's removed on stop
      try {
		var MPDdata = fs.readFileSync(MPDtmpl, 'utf8'); 
		if (!MPDdata.includes('include_optional')){
			fs.copySync(MPDtmpl, MPD); // copy orignal template file to /tmp
			self.add_mpd_include (MPD) // change the copy
                .then(self.mount_tmpl.bind(self, MPD, MPDtmpl)) // mount over original template
                .then(self.recreate_mpdconf.bind(self))         // recreate mpd.conf on /etc
                .then(self.restartMpd.bind(self));              // if the plugin starts to late restart mpd needed
		}
      } catch (err) {
        self.logger.error(id + MPDtmpl + 'not found');
      }

      // use spectrum config in /tmp (RAM)
      //fs.copySync(SpectrumConf, SpectrumTmp); // copy orignal template file to /tmp
      //self.mount_tmpl(SpectrumTmp, SpectrumConf) // mount over original template

    
      last_outputdevice = self.getAlsaConfigParam('outputdevice');
      last_softmixer = self.getAlsaConfigParam('softvolume');
      
      //self.updateALSAConfigFile().then (function(){
             
        // modular alsa 16bit/24bit enabled, switch if needed
        //var alsaconf = parseInt(self.config.get('alsaSelection'),10);
        //if (alsaconf == 0) {
        //    self.get_output_enabled(MPD_include).then (function(OutEnabled) {
        //        if (OutEnabled) {
        //            self.switch_alsaConfig(alsaconf);                      
        //        }  
        //    });
            
            
        // native DSD enabled, switch if needed
        //} else {            
        //    self.get_output_enabled(MPD_include).then (function(OutEnabled) {
        //        if (!OutEnabled) {
        //            self.switch_alsaConfig(alsaconf);                      
        //        }
        //    });
        //}
      
      //});
      
      // event callback if outputdevice or mixer changed
      self.commandRouter.sharedVars.registerCallback('alsa.outputdevice', self.switch_alsaModular.bind(self));
      
      // synchronize external spotify settings with own configuration  
      if (fs.existsSync(spotify_config) && self.getPluginStatus ('music_service', 'spop') === 'STARTED'){
        var spotifydata = fs.readFileSync(spotify_config, 'utf8'); 
        //var useSpot = self.config.get('useSpotify');
        //if ((useSpot && spotifydata.includes('volumio')) || (!useSpot && spotifydata.includes('spotify'))) {
        //    self.switch_Spotify(useSpot);
        //}
        var useDSP = fs.existsSync(dsp_config) && self.config.get('useDSP');
        if ((!useDSP && spotifydata.includes('volumio')) || (useDSP && spotifydata.includes('spotify'))) {
            self.switch_Spotify(!useDSP);
        }
      }  

	  // synchronize external airplay settings with own configuration
      if (fs.existsSync(AIRtmpl) && self.getPluginStatus ('music_service', 'airplay_emulation') === 'STARTED'){
		var airplaydata = fs.readFileSync(AIRtmpl, 'utf8'); 
		var useAir = self.config.get('useAirplay');
		if ((useAir && airplaydata.includes('${device}')) || (!useAir && airplaydata.includes('airplay'))) {
			self.switch_Airplay(useAir);
		}
	  }
	  
    } else {    
        // ________________ Jessie _________________
        self.logger.error('+++ Jessie not more supported! +++');
    }

    // event function on change state, to start PeppyMeter    
    socket.emit('getState', '');
    socket.on('pushState', function (state) {
        
        // screensaver only for enabled Spotify/Airplay support, enabled DSP and all other
        var DSP_ON = fs.existsSync(dsp_config) && self.config.get('useDSP');
		var Spotify_ON = fs.existsSync(spotify_config) && self.getPluginStatus ('music_service', 'spop') === 'STARTED' && self.config.get('useSpotify') && state.service === 'spop';
        var Airplay_ON = fs.existsSync(AIRtmpl) && self.getPluginStatus ('music_service', 'airplay_emulation') === 'STARTED' && self.config.get('useAirplay') && state.service === 'airplay_emulation';
		var Other_ON = state.service !== 'spop' && state.service !== 'airplay_emulation';
        
        if (state.status === 'play' && !lastStateIsPlaying) {
          if (DSP_ON || Spotify_ON || Airplay_ON || Other_ON) {
            lastStateIsPlaying = true;
            var ScreenTimeout = (parseInt(self.config.get('timeout'),10)) * 1000;
          
            if (ScreenTimeout > 0){ // for 0 do nothing
                Timeout = setInterval(function () {
                  if (!fs.existsSync(runFlag)){
                    exec( RunPeppyFile, { uid: 1000, gid: 1000 }, function (error, stdout, stderr) {        
                    if (error !== null) {
                        self.logger.error(id + 'Error start PeppyMeter: ' + error);
                    } else {
                        self.logger.info(id + 'Start PeppyMeter');
                    }    
                  });
                  }        
                }, ScreenTimeout);
            }
          }
        } else if (lastStateIsPlaying) {
            if (state.status === 'pause' || (state.status === 'stop' && (state.service === 'webradio' || state.uri === ''))) {
                if (fs.existsSync(runFlag)){fs.removeSync(runFlag);}
                clearTimeout(Timeout);
                lastStateIsPlaying = false;
            }
        }
    });
    
    // Once the Plugin has successfull started resolve the promise
	defer.resolve();       
 
    return defer.promise;
}; // end onStart ----------------------------


peppyScreensaver.prototype.onStop = function() {
    var self = this;
    var defer=libQ.defer();

    self.commandRouter.stateMachine.stop().then(function () {
        if (fs.existsSync(MPD)){
            //unmount mpd_tmpl file, if mounted
            self.unmount_tmpl(MPDtmpl)
                .then(function() {fs.removeSync(MPD);}
            );
                //.then(function(){                  
                //    self.recreate_mpdconf();
                //        .then(self.restartMpd.bind(self));
                //});
        } else {
            self.logger.info (id + 'mpd template already unmounted');
        }

        //umount spectrum config
        //if (fs.existsSync(SpectrumTmp)){self.unmount_tmpl(SpectrumConf);}
        
        //unmount air_tmpl file, if mounted
        if (fs.existsSync(AIR)){self.unmount_tmpl(AIRtmpl);}
        
        // redirect spotify to volumio
        if (fs.existsSync(spotify_config)){self.switch_Spotify(false);}
		
        // remove old flag
        if (fs.existsSync(runFlag)){fs.removeSync(runFlag);}
        
        defer.resolve();                
          
        // stop events
        socket.off('pushState');
    });
    
    return libQ.resolve();
}; // end onStop ---------------------------------


peppyScreensaver.prototype.onRestart = function() {
    var self = this;
    // Optional, use if you need it
};

peppyScreensaver.prototype.onInstall = function () {
    var self = this;
};

peppyScreensaver.prototype.onUninstall = function () {
  var self = this;
  //Perform your installation tasks here
  
        // remove MPD_include file
        if (fs.existsSync(MPD_include)){fs.removeSync(MPD_include);}
        
        if (fs.existsSync(spotify_config)){
            // redirect spotify to volumio
            self.switch_Spotify(false);
        }
		if (fs.existsSync(AIR)){
            //unmount air_tmpl file, if mounted
            self.unmount_tmpl(AIRtmpl);
        //        .then(function() {fs.removeSync(AIR);});
		}
};

// Configuration Methods -----------------------------------------------------------------------------

peppyScreensaver.prototype.getUIConfig = function() {
    var defer = libQ.defer();
    var self = this;

    var lang_code = self.commandRouter.sharedVars.get('language_code');

    self.commandRouter.i18nJson(__dirname+'/i18n/strings_'+lang_code+'.json',
        __dirname+'/i18n/strings_en.json',
        __dirname + '/UIConfig.json')
        .then(function(uiconf)
        {
        
        // section 0 -----------------------------        
        if (fs.existsSync(PeppyConf)){
            // read values from ini
            //var config = ini.parse(fs.readFileSync(config_file, 'utf-8'));
            var meters_file = base_folder_P + peppy_config.current[meterFolderStr] + '/meters.txt';
            var upperc = /\b([^-])/g;
            
            // alsa configuration only for buster
            if (self.IfBuster()) {
                var alsaconf = parseInt(self.config.get('alsaSelection'),10);
                if (self.config.get('useDSP')) {
                    uiconf.sections[0].content[0].value.value = 0;
                    uiconf.sections[0].content[0].value.label = self.commandRouter.getI18nString('PEPPY_SCREENSAVER.ALSA_SELECTION_0');
                } else {
                    uiconf.sections[0].content[0].value.value = alsaconf;
                    uiconf.sections[0].content[0].value.label = self.commandRouter.getI18nString('PEPPY_SCREENSAVER.ALSA_SELECTION_' + self.config.get('alsaSelection'));
                }
                
                // Dsp integration
                if (fs.existsSync(dsp_config)){
                    var useDSP = self.config.get('useDSP');
                    uiconf.sections[0].content[1].value = useDSP;
                    self.checkDSPactive(!useDSP);
                } else {
                    self.config.set('useDSP', false);
                    uiconf.sections[0].content[1].hidden = true;
                }
                // Spotify integration
                if (fs.existsSync(spotify_config)){
                    if (self.getPluginStatus ('music_service', 'spop') === 'STARTED') {
                        if (self.config.get('useDSP')) {
                            self.config.set('useSpotify', false);
                        } else {
                            uiconf.sections[0].content[2].value = self.config.get('useSpotify');
                            uiconf.sections[0].content[3].value = self.config.get('useUSBDAC');
                        }
                    } else {
                        uiconf.sections[0].content[2].hidden = true; // hide spotify
                        uiconf.sections[0].content[3].hidden = true; // hide USB-DAC
                    }
                } else {
                    self.config.set('useSpotify', false);
                    uiconf.sections[0].content[2].hidden = true;
                    uiconf.sections[0].content[3].hidden = true;
                }
                // Airplay integration
                if (self.getPluginStatus ('music_service', 'airplay_emulation') === 'STARTED'){
                    if (self.config.get('useDSP')) {
                        self.config.set('useAirplay', false);
                    } else {
                        uiconf.sections[0].content[4].value = self.config.get('useAirplay');
                    }
                } else {
                    uiconf.sections[0].content[4].hidden = true;
                }
            }
            
            // screensaver timeout
            uiconf.sections[0].content[5].value = self.config.get('timeout');
            minmax[0] = [uiconf.sections[0].content[5].attributes[2].min,
                uiconf.sections[0].content[5].attributes[3].max,
                uiconf.sections[0].content[5].attributes[0].placeholder];
            
            // active folder
            // fill selection list with custom folders
            var files = fs.readdirSync(base_folder_P);
            files.forEach(file => {
                var stat = fs.statSync(base_folder_P + file);
                if (stat.isDirectory() && file.includes ('_')) {
                    var partFile = file.split('_');
                    var str_empty = fs.existsSync(base_folder_P + file + '/meters.txt') ? '' : ' (empty)';
                    self.configManager.pushUIConfigParam(uiconf, 'sections[0].content[6].options', {
                        value: file,
                        label: (partFile[1]).replace(upperc, c => c.toUpperCase()) + '-' +  partFile[2] + ' ' + partFile[0] + str_empty
                    });
                }
            });
            //if (self.config.get('activeFolder') == '') {
            var meterFolder = peppy_config.current[meterFolderStr];
            if (meterFolder.includes ('_')) {
                var partFile = meterFolder.split('_');
                var str_empty = fs.existsSync(base_folder_P + meterFolder + '/meters.txt') ? '' : ' (empty)';
                uiconf.sections[0].content[6].value.value = meterFolder;
                uiconf.sections[0].content[6].value.label = (partFile[1]).replace(upperc, c => c.toUpperCase()) + '-' +  partFile[2] + ' ' + partFile[0] + str_empty;
            } else {
                uiconf.sections[0].content[6].value.value = self.config.get('activeFolder');
                uiconf.sections[0].content[6].value.label = self.config.get('activeFolder_title');
            }

            if (use_SDL2) {
            // position type
                if (peppy_config.current['position.type'] == 'center') { 
                    uiconf.sections[0].content[7].value.value = 0;
                    uiconf.sections[0].content[7].value.label = 'centered';
                } else {
                    uiconf.sections[0].content[7].value.value = 1;
                    uiconf.sections[0].content[7].value.label = 'manually';
                }
            // position x
                uiconf.sections[0].content[8].value = parseInt(peppy_config.current['position.x'], 10);
                minmax[1] = [uiconf.sections[0].content[8].attributes[2].min,
                    uiconf.sections[0].content[8].attributes[3].max,
                    uiconf.sections[0].content[8].attributes[0].placeholder];
            // position y
                uiconf.sections[0].content[9].value = parseInt(peppy_config.current['position.y'], 10);
                minmax[2] = [uiconf.sections[0].content[9].attributes[2].min,
                    uiconf.sections[0].content[9].attributes[3].max,
                    uiconf.sections[0].content[9].attributes[0].placeholder];
            // animation
                var animation = (peppy_config.current['start.animation']).toLowerCase() == 'true' ? true : false;
                uiconf.sections[0].content[10].value = animation;
            } else {
                uiconf.sections[0].content[7].hidden = true;
                uiconf.sections[0].content[7].value.value = 0;
                uiconf.sections[0].content[7].value.label = 'centered';

                uiconf.sections[0].content[10].hidden = true; // animation
                uiconf.sections[0].content[10].value = false;
            }

            // smooth buffer
            uiconf.sections[0].content[11].value = parseInt(peppy_config.data.source['smooth.buffer.size'], 10);                                
            minmax[3] = [uiconf.sections[0].content[11].attributes[2].min,
                uiconf.sections[0].content[11].attributes[3].max,
                uiconf.sections[0].content[11].attributes[0].placeholder];

            // needle cache
            var needleCache = (peppy_config.current['use.cache']).toLowerCase() == 'true' ? true : false;
            uiconf.sections[0].content[12].value = needleCache;

            // cache size
            uiconf.sections[0].content[13].value = parseInt(peppy_config.current['cache.size'], 10);                                
            minmax[4] = [uiconf.sections[0].content[13].attributes[2].min,
                uiconf.sections[0].content[13].attributes[3].max,
                uiconf.sections[0].content[13].attributes[0].placeholder];
                
            // mouse support
            var mouseSupport = (peppy_config.sdl.env['mouse.enabled']).toLowerCase() == 'true' ? true : false;
            uiconf.sections[0].content[14].value = mouseSupport;

            // display output
            uiconf.sections[0].content[15].value.value = self.config.get('displayOutput');
            uiconf.sections[0].content[15].value.label = 'Display=' + self.config.get('displayOutput');
             
            // section 1 ------------
            availMeters = '';
           
            if (fs.existsSync(meters_file)){
                var metersconfig = ini.parse(fs.readFileSync(meters_file, 'utf-8'));

                // current meter
                if ((peppy_config.current.meter).includes(',')) {
                    uiconf.sections[1].content[0].value.value = 'list';
                } else {
                    uiconf.sections[1].content[0].value.value = peppy_config.current.meter;
                }
                uiconf.sections[1].content[0].value.label = (uiconf.sections[1].content[0].value.value).replace(upperc, c => c.toUpperCase());

                // read all sections from active meters.txt and fill selection list
                for (var section in metersconfig) {
                    availMeters += section + ', ';
                    self.configManager.pushUIConfigParam(uiconf, 'sections[1].content[0].options', {
                        value: section,
                        label: section.replace(upperc, c => c.toUpperCase())
                    });
                }

                // list selection
                availMeters = availMeters.substring(0, availMeters.length -2);
                if (self.config.get('randomSelection') == '') {
                    uiconf.sections[1].content[1].value = availMeters;
                } else {
                    uiconf.sections[1].content[1].value = self.config.get('randomSelection');
                }
                uiconf.sections[1].content[1].doc = self.commandRouter.getI18nString('PEPPY_SCREENSAVER.RANDOMSELECTION_DOC') + '<b>' + availMeters + '</b>';

                // random mode (visible only for random and list)
                if (uiconf.sections[1].content[0].value.value == 'random' || uiconf.sections[1].content[0].value.value == 'list') {
                    uiconf.sections[1].content[2].hidden = false;
                }
                var random_change_title = (peppy_config.current['random.change.title']).toLowerCase() == 'true' ? true : false;
                if (random_change_title) {
                    uiconf.sections[1].content[2].value.value = 'titlechange';
                    uiconf.sections[1].content[2].value.label = 'On Title Change';
                } else {
                    uiconf.sections[1].content[2].value.value = 'interval';
                    uiconf.sections[1].content[2].value.label = 'Interval';
                }    
                
                // random intervall
                uiconf.sections[1].content[3].value = parseInt(peppy_config.current['random.meter.interval'], 10);
                minmax[5] = [uiconf.sections[1].content[3].attributes[2].min,
                    uiconf.sections[1].content[3].attributes[3].max,
                    uiconf.sections[1].content[3].attributes[0].placeholder];

            }
            
        } else {
            self.commandRouter.pushToastMessage('error', self.commandRouter.getI18nString('PEPPY_SCREENSAVER.PLUGIN_NAME'), self.commandRouter.getI18nString('PEPPY_SCREENSAVER.NO_PEPPYCONFIG'));            
        }
            defer.resolve(uiconf);
        })
        .fail(function()
        {
            defer.reject(new Error());
        });


    
    return defer.promise;
}; // end getUIConfig -----------------------------------

peppyScreensaver.prototype.getConfigurationFiles = function() {
	return ['config.json'];
};

// called when 'save' button pressed on global settings
//-------------------------------------------------------
peppyScreensaver.prototype.savePeppyMeterConf = function (confData) {
  const self = this;
  let noChanges = true;
  uiNeedsUpdate = false;
  let uiNeedsReboot = false;
  
  if (fs.existsSync(PeppyConf)){
    //var config = ini.parse(fs.readFileSync(PeppyConf, 'utf-8'));

    // write DSP
    if (self.IfBuster()) {
        if (self.config.get('useDSP') != confData.useDSP) {
            self.config.set('useDSP', confData.useDSP);
            self.checkDSPactive(!confData.useDSP);
            self.switch_Spotify(!confData.useDSP);
            noChanges = false;
            uiNeedsReboot = true;
        }
    }
    
    // write alsa selection
    if (self.IfBuster()) {        
        if (confData.useDSP) {
            self.config.set('alsaSelection', 0);
        } else if (self.config.get('alsaSelection') != confData.alsaSelection.value) {
            self.config.set('alsaSelection', confData.alsaSelection.value);
            noChanges = false;
            uiNeedsReboot = true;
        }
    }

    // write spotify /USB-DAC
    if (self.IfBuster() && self.getPluginStatus ('music_service', 'spop') === 'STARTED') {
        if (confData.useDSP) {
            self.config.set('useSpotify', false);
            //self.switch_Spotify(false);
        } else {
            if (self.config.get('useSpotify') != confData.useSpotify) {
                self.config.set('useSpotify', confData.useSpotify);
                //self.switch_Spotify(confData.useSpotify);
                noChanges = false;
                uiNeedsReboot = true;
            }
            if (self.config.get('useUSBDAC') != confData.useUSBDAC) {
                self.config.set('useUSBDAC', confData.useUSBDAC);
                noChanges = false;
                uiNeedsReboot = true;
            }
        }
    }
    
    // write airplay
    if (self.IfBuster() && self.getPluginStatus ('music_service', 'airplay_emulation') === 'STARTED'){
        if (confData.useDSP) {
            self.config.set('useAirplay', false);
            self.switch_Airplay(false);
        } else if (self.config.get('useAirplay') != confData.useAirplay) {
            self.config.set('useAirplay', confData.useAirplay);
            self.switch_Airplay(confData.useAirplay);
            noChanges = false;
        }
    }
    
    // write timeout
    if (Number.isNaN(parseInt(confData.timeout, 10)) || !isFinite(confData.timeout)) {
        uiNeedsUpdate = true;
        setTimeout(function () {
            self.commandRouter.pushToastMessage('error', self.commandRouter.getI18nString('PEPPY_SCREENSAVER.PLUGIN_NAME'), self.commandRouter.getI18nString('PEPPY_SCREENSAVER.TIMEOUT') + self.commandRouter.getI18nString('PEPPY_SCREENSAVER.NAN'));
        }, 500);
    } else {
        confData.timeout = self.minmax('TIMEOUT', confData.timeout, minmax[0]);
        if (confData.timeout != self.config.get('timeout')){        
            self.config.set('timeout', confData.timeout);
            noChanges = false;
        }
    }
   
    // write active folder
    if (peppy_config.current[meterFolderStr] !== confData.activeFolder.value) {
        peppy_config.current[meterFolderStr] = confData.activeFolder.value;
        spectrum_config.current[SpectrumFolderStr] = confData.activeFolder.value;
        self.config.set('activeFolder', confData.activeFolder.value);
        self.config.set('activeFolder_title', confData.activeFolder.label);
        // reset active meter and save also
        peppy_config.current.meter = 'random';
        self.config.set('randomSelection', '');
        noChanges = false;
        uiNeedsUpdate = true;
        self.checkMetersFile();
    }

    if (use_SDL2) {
        // write position type        
        var pos_type = confData.positionType.value == 0? 'center' : 'manual';
        if (peppy_config.current['position.type'] !== pos_type) {
            peppy_config.current['position.type'] = pos_type;
            noChanges = false;
        }
        // write position x
        if (Number.isNaN(parseInt(confData.position_x, 10)) || !isFinite(confData.position_x)) {
            uiNeedsUpdate = true;
            setTimeout(function () {
                self.commandRouter.pushToastMessage('error', self.commandRouter.getI18nString('PEPPY_SCREENSAVER.PLUGIN_NAME'), self.commandRouter.getI18nString('PEPPY_SCREENSAVER.POS_X') + self.commandRouter.getI18nString('PEPPY_SCREENSAVER.NAN'));
            }, 500);
        } else {
            confData.position_x = self.minmax('POS_X', confData.position_x, minmax[1]);
            if (peppy_config.current['position.x'] != confData.position_x) {
                peppy_config.current['position.x'] = confData.position_x;
                noChanges = false;
            }
        }
        // write position y
        if (Number.isNaN(parseInt(confData.position_y, 10)) || !isFinite(confData.position_y)) {
            uiNeedsUpdate = true;
            setTimeout(function () {
                self.commandRouter.pushToastMessage('error', self.commandRouter.getI18nString('PEPPY_SCREENSAVER.PLUGIN_NAME'), self.commandRouter.getI18nString('PEPPY_SCREENSAVER.POS_Y') + self.commandRouter.getI18nString('PEPPY_SCREENSAVER.NAN'));
            }, 500);
        } else {
            confData.position_y = self.minmax('POS_Y', confData.position_y, minmax[2]);
            if (peppy_config.current['position.y'] != confData.position_y) {
                peppy_config.current['position.y'] = confData.position_y;
                noChanges = false;
            }
        }
        // write animation
        var animation = confData.animation? 'True' : 'False';
        if (peppy_config.current['start.animation'] != animation) {
            peppy_config.current['start.animation'] = animation;
            noChanges = false;
        }
    }
    
    // write screen width/height
    var dimensions = {'width':'', 'height':''};
    var files = fs.readdirSync(base_folder_P + confData.activeFolder.value);
    files.forEach(file => {
        if (file.indexOf('-ext.') >= 0) {
            dimensions = sizeOf(base_folder_P + confData.activeFolder.value + '/' + file);
            files.length = 0;
        }
    });    
    peppy_config.current['screen.width'] = dimensions.width;
    peppy_config.current['screen.height'] = dimensions.height;
    
    
    // write needle cache
    var needleCache = confData.needleCache? 'True' : 'False';
    if (peppy_config.current['use.cache'] != needleCache) {
        peppy_config.current['use.cache'] = needleCache;
        noChanges = false;
    }
    
    // write cache size
    if (Number.isNaN(parseInt(confData.cachesize, 10)) || !isFinite(confData.cachesize)) {
        uiNeedsUpdate = true;
        setTimeout(function () {
            self.commandRouter.pushToastMessage('error', self.commandRouter.getI18nString('PEPPY_SCREENSAVER.PLUGIN_NAME'), self.commandRouter.getI18nString('PEPPY_SCREENSAVER.CACHESIZE') + self.commandRouter.getI18nString('PEPPY_SCREENSAVER.NAN'));
        }, 500);
    } else {
        confData.cachesize = self.minmax('CACHESIZE', confData.cachesize, minmax[4]);
        if (peppy_config.current['cache.size'] != confData.cachesize) {
            peppy_config.current['cache.size'] = confData.cachesize;
            noChanges = false;
        }
    }    
    
    // smooth buffer
    if (Number.isNaN(parseInt(confData.smoothBuffer, 10)) || !isFinite(confData.smoothBuffer)) {
        uiNeedsUpdate = true;
        setTimeout(function () {
            self.commandRouter.pushToastMessage('error', self.commandRouter.getI18nString('PEPPY_SCREENSAVER.PLUGIN_NAME'), self.commandRouter.getI18nString('PEPPY_SCREENSAVER.SMOOTH_BUFFER') + self.commandRouter.getI18nString('PEPPY_SCREENSAVER.NAN'));
        }, 500);
    } else {
        confData.smoothBuffer = self.minmax('SMOOTH_BUFFER', confData.smoothBuffer, minmax[3]);
        if (peppy_config.data.source['smooth.buffer.size'] != confData.smoothBuffer) {
            peppy_config.data.source['smooth.buffer.size'] = confData.smoothBuffer;
            noChanges = false;
        }
    }

    // write mouse support
    var mouseSupport = confData.mouseEnabled? 'True' : 'False';
    if (peppy_config.sdl.env['mouse.enabled'] != mouseSupport) {
        peppy_config.sdl.env['mouse.enabled'] = mouseSupport;
        noChanges = false;
    }

    // write display port
    if (self.config.get('displayOutput') != confData.displayOutput.value) {
        self.config.set('displayOutput', confData.displayOutput.value);
        var DispOut = parseInt(confData.displayOutput.value,10);
        self.switch_DisplayPort(DispOut);
        noChanges = false;
    }
        
    if (!noChanges) {
        fs.writeFileSync(PeppyConf, ini.stringify(peppy_config, {whitespace: true}));
        fs.writeFileSync(SpectrumConf, ini.stringify(spectrum_config, {whitespace: true}));
        // unmount /tmp/config to make changes permanent
        //self.unmount_tmpl(SpectrumConf)
        //    .then(function() {
        //        fs.writeFileSync(SpectrumConf, ini.stringify(spectrum_config, {whitespace: true}));
        //        fs.copySync(SpectrumConf, SpectrumTmp); // copy orignal template file to /tmp
        //        self.mount_tmpl(SpectrumTmp, SpectrumConf); // mount over original template
        //    }
        //);
    }
  } else {
      self.commandRouter.pushToastMessage('error', self.commandRouter.getI18nString('PEPPY_SCREENSAVER.PLUGIN_NAME'), self.commandRouter.getI18nString('PEPPY_SCREENSAVER.NO_PEPPYCONFIG'));
  }
  
  if (uiNeedsUpdate) {self.updateUIConfig();}
  if (uiNeedsReboot) {
      self.switch_alsaConfig(parseInt(self.config.get('alsaSelection'),10));
      //self.rebootMessage();}
  }

  setTimeout(function () {
    if (noChanges) {
        self.commandRouter.pushToastMessage('info', self.commandRouter.getI18nString('PEPPY_SCREENSAVER.PLUGIN_NAME'), self.commandRouter.getI18nString('PEPPY_SCREENSAVER.NO_CHANGES'));
    } else {
        self.commandRouter.pushToastMessage('success', self.commandRouter.getI18nString('PEPPY_SCREENSAVER.PLUGIN_NAME'), self.commandRouter.getI18nString('COMMON.SETTINGS_SAVED_SUCCESSFULLY'));
    }
  }, 500);
  
}; // end savePeppyMeterConf ----------------------------

// called when 'save' button pressed on VU-Meter settings
// ------------------------------------------------------
peppyScreensaver.prototype.saveVUMeterConf = function (confData) {
  const self = this;
  let noChanges = true;
  uiNeedsUpdate = false;
  
  if (fs.existsSync(PeppyConf)){
    //var config = ini.parse(fs.readFileSync(PeppyConf, 'utf-8'));
    
    // write selected meter
    if ((confData.meter.value !== 'list' && peppy_config.current.meter !== confData.meter.value) || (confData.meter.value == 'list' && peppy_config.current.meter !== confData.randomSelection)) {
        if (confData.meter.value === 'list') {
            if (confData.randomSelection !== ''){
				if (self.checkListMode(confData.randomSelection)) {
                    peppy_config.current.meter = (confData.randomSelection);
                    self.config.set('randomSelection', (confData.randomSelection));
                }
            } else {
                peppy_config.current.meter = availMeters;
                self.config.set('randomSelection', availMeters);
            }
        } else {
            peppy_config.current.meter = confData.meter.value;
        }
        uiNeedsUpdate = true;
        noChanges = false;
    }

    // write random mode
    var random_change_title = (peppy_config.current['random.change.title']).toLowerCase() == 'true' ? true : false;
    if ((confData.randomMode.value == 'titlechange' && !random_change_title) || (confData.randomMode.value == 'interval' && random_change_title)){
        if (confData.randomMode.value == 'titlechange') {
            peppy_config.current['random.change.title'] = 'True';
        } else {
            peppy_config.current['random.change.title'] = 'False';
        }
        uiNeedsUpdate = true;
        noChanges = false;    
    }
    
    // write random interval
    if (Number.isNaN(parseInt(confData.randomInterval, 10)) || !isFinite(confData.randomInterval)) {
        uiNeedsUpdate = true;
        setTimeout(function () {
            self.commandRouter.pushToastMessage('error', self.commandRouter.getI18nString('PEPPY_SCREENSAVER.PLUGIN_NAME'), self.commandRouter.getI18nString('PEPPY_SCREENSAVER.RANDOMINTERVAL') + self.commandRouter.getI18nString('PEPPY_SCREENSAVER.NAN'));
        }, 500);
    } else {
        confData.randomInterval = self.minmax('RANDOMINTERVAL', confData.randomInterval, minmax[5]);
        if (peppy_config.current['random.meter.interval'] != confData.randomInterval) {
            peppy_config.current['random.meter.interval'] = confData.randomInterval;
            noChanges = false;
        }
    }
    
    if (!noChanges) {
        fs.writeFileSync(PeppyConf, ini.stringify(peppy_config, {whitespace: true}));
    }
  } else {
      self.commandRouter.pushToastMessage('error', self.commandRouter.getI18nString('PEPPY_SCREENSAVER.PLUGIN_NAME'), self.commandRouter.getI18nString('PEPPY_SCREENSAVER.NO_PEPPYCONFIG'));
  }
  
  if (uiNeedsUpdate) {self.updateUIConfig();}
  setTimeout(function () {
    if (noChanges) {
        self.commandRouter.pushToastMessage('info', self.commandRouter.getI18nString('PEPPY_SCREENSAVER.PLUGIN_NAME'), self.commandRouter.getI18nString('PEPPY_SCREENSAVER.NO_CHANGES'));
    } else {
        self.commandRouter.pushToastMessage('success', self.commandRouter.getI18nString('PEPPY_SCREENSAVER.PLUGIN_NAME'), self.commandRouter.getI18nString('COMMON.SETTINGS_SAVED_SUCCESSFULLY'));
    }
  }, 500);
}; // end saveVUMeterConf -------------------------------------

// global functions
//-------------------------------------------------------------
peppyScreensaver.prototype.minmax = function (item, value, attrib) {
  var self = this;
  if (Number.isNaN(parseInt(value, 10)) || !isFinite(value)) {
      uiNeedsUpdate = true;
      return attrib[2];
  }
    if (value < attrib[0]) {
        setTimeout(function () {
            self.commandRouter.pushToastMessage("info", self.commandRouter.getI18nString('PEPPY_SCREENSAVER.PLUGIN_NAME'), self.commandRouter.getI18nString('PEPPY_SCREENSAVER.' + item.toUpperCase()) + ': ' + self.commandRouter.getI18nString('PEPPY_SCREENSAVER.INFO_MIN'));
        }, 700);        
        uiNeedsUpdate = true;
        return attrib[0];
    }
    if (value > attrib[1]) {
        setTimeout(function () {
            self.commandRouter.pushToastMessage("info", self.commandRouter.getI18nString('PEPPY_SCREENSAVER.PLUGIN_NAME'), self.commandRouter.getI18nString('PEPPY_SCREENSAVER.' + item.toUpperCase()) + ': ' + self.commandRouter.getI18nString('PEPPY_SCREENSAVER.INFO_MAX'));
        }, 700); 
        uiNeedsUpdate = true;
        return attrib[1];
    }
    return parseInt(value, 10);
};

peppyScreensaver.prototype.updateUIConfig = function () {
  const self = this;
  const defer = libQ.defer();

  self.commandRouter.getUIConfigOnPlugin('user_interface', 'peppy_screensaver', {})
    .then(function (uiconf) {
      self.commandRouter.broadcastMessage('pushUiConfig', uiconf);
    });
  self.commandRouter.broadcastMessage('pushUiConfig');
  uiNeedsUpdate = false;
  return defer.promise;
};

peppyScreensaver.prototype.checkDSPactive = function (DSD){
  const self = this;
  const defer = libQ.defer();
  let DSPMessage = "";
  let DSPMessageTitle = "";
  let DSPactive = self.getPluginStatus ('audio_interface', 'fusiondsp') === 'STARTED';
	    
    if(DSD && DSPactive){	
        DSPMessageTitle = self.commandRouter.getI18nString('PEPPY_SCREENSAVER.DSPWARNING_TITLE');
        DSPMessage = self.commandRouter.getI18nString('PEPPY_SCREENSAVER.DSPWARNING');
    }
    if(!DSD && !DSPactive){
        DSPMessageTitle = self.commandRouter.getI18nString('PEPPY_SCREENSAVER.NODSPWARNING_TITLE');
        DSPMessage = self.commandRouter.getI18nString('PEPPY_SCREENSAVER.NODSPWARNING');
    }
    if (DSPMessage != ""){
        setTimeout(function () {
            self.commandRouter.pushToastMessage('warning', DSPMessageTitle, DSPMessage);
        }, 1500);
    }

  return defer.promise;
};


peppyScreensaver.prototype.checkMetersFile = function (){
    const self = this;
    const defer = libQ.defer();
    var meters_file = base_folder_P + peppy_config.current[meterFolderStr] + '/meters.txt';
  
    if (!fs.existsSync(meters_file)){
        setTimeout(function () {
            self.commandRouter.pushToastMessage('warning', self.commandRouter.getI18nString('PEPPY_SCREENSAVER.NOMETERSWARNING_TITLE'), self.commandRouter.getI18nString('PEPPY_SCREENSAVER.NOMETERSWARNING'));
        }, 1500);
    }

    return defer.promise;
};

peppyScreensaver.prototype.checkListMode = function (listStr){
    const self = this;
	
	var meters_file = base_folder_P + peppy_config.current[meterFolderStr] + '/meters.txt';
	var meterSectArray = [];
    var listError = [];
	var listArray = (listStr).split(',');
	var not_found = false;
	
	if (fs.existsSync(meters_file)){
	    var metersconfig = ini.parse(fs.readFileSync(meters_file, 'utf-8'));
		
		// get sections from file	
		for (var section in metersconfig) {
			meterSectArray.push(section);
		}
		// check if list entry in section
		for (var i in listArray) {
			if (!meterSectArray.includes(listArray[i].trim())) {
                listError.push(listArray[i]);
                not_found = true;
            }
		}
	
	} else {
		not_found = true;
	}
  
    if (not_found){
        setTimeout(function () {
        // create a hint as modal
        var responseData = {
        title: self.commandRouter.getI18nString('PEPPY_SCREENSAVER.NOTINLIST_TITLE'),
        message: self.commandRouter.getI18nString('PEPPY_SCREENSAVER.NOTINLIST') + listError,
        size: 'lg',
        buttons: [
            {
            name: self.commandRouter.getI18nString('COMMON.GOT_IT'),
            class: 'btn btn-info ng-scope',
            emit: '',
            payload: ''
            }
        ]
        };
        self.commandRouter.broadcastMessage('openModal', responseData);
        }, 1000);
		return false;
    }

    return true;
};


peppyScreensaver.prototype.install_dummy = function () {
  const self = this;
  let defer = libQ.defer();
  
  try {
    execSync("/usr/bin/sudo /sbin/modprobe snd-dummy index=7 pcm_substreams=1 fake_buffer=0", { uid: 1000, gid: 1000 });
//    execSync("/usr/bin/sudo /sbin/modprobe snd-aloop", { uid: 1000, gid: 1000 });
    self.commandRouter.pushConsoleMessage('snd-dummy loaded');
    defer.resolve();
  } catch (err) {
    self.logger.info('failed to load snd-dummy' + err);
  }
};

peppyScreensaver.prototype.install_mkfifo = function (fifoName) {
  const self = this;
  let defer = libQ.defer();
  
  try {
    exec('/usr/bin/mkfifo -m 646 ' + fifoName, { uid: 1000, gid: 1000 });
    self.commandRouter.pushConsoleMessage(fifoName + ' created');
    defer.resolve();
  } catch (err) {
    self.logger.info('failed to create ' + fifoName + ' ' + err);
  }    
};

// buster switch alsa config
peppyScreensaver.prototype.switch_alsaConfig = function (alsaConf) {
    const self = this;
    var defer = libQ.defer();
    var enableDSD = alsaConf == 1 ? true : false;
    
    self.MPD_setOutput(MPD_include, enableDSD)
//        .then(self.MPD_allowedFormats.bind(self, MPD, enableDSD)) // not more needed
        .then(self.writeAsoundConfigModular.bind(self, alsaConf))
        .then(self.updateALSAConfigFile.bind(self))
//        .then(self.updateMountpoint.bind(self, MPD, MPDtmpl))     // not more needed with MPD_include
//        .then(self.recreate_mpdconf.bind(self))                   // not more needed with MPD_include
        .then(self.restartMpd.bind(self));
    defer.resolve
    return defer.promise;    
};

// switch display port
peppyScreensaver.prototype.switch_DisplayPort = function (DispOut) {
    const self = this;
    var defer = libQ.defer();
    
    if (fs.existsSync(RunPeppyFile)){
        var runPeppydata = fs.readFileSync(RunPeppyFile, 'utf8');
        if (DispOut == "0") {
            runPeppydata = runPeppydata.replace('DISPLAY=:1', 'DISPLAY=:' + DispOut);
        } else {
            runPeppydata = runPeppydata.replace('DISPLAY=:0', 'DISPLAY=:' + DispOut);
        }

        fs.writeFile(RunPeppyFile, runPeppydata, 'utf8', function (err) {
            if (err) {
                self.logger.info('Cannot write ' + RunPeppyFile + err);
            } else {               
                defer.resolve();
            }
        });
    } else {
        defer.resolve();
    }

    return defer.promise;
};

// buster enable spotify alsa pipe
peppyScreensaver.prototype.switch_Spotify = function (useSpotify) {
    const self = this;
    var defer = libQ.defer();
    //var useDSP = fs.existsSync(dsp_config) && self.config.get('useDSP');

    // only if spotify installed
    if (fs.existsSync(spotify_config)){
        var spotifydata = fs.readFileSync(spotify_config, 'utf8'); 
        if (useSpotify) {
            spotifydata = spotifydata.replace('volumio', 'spotify');
        } else {
            spotifydata = spotifydata.replace('spotify', 'volumio');
        }

        fs.writeFile(spotify_config, spotifydata, 'utf8', function (err) {
            if (err) {
                self.logger.info('Cannot write ' + spotify_config + err);
            } else {              
                var cmdret = self.commandRouter.executeOnPlugin('music_service', 'spop', 'initializeLibrespotDaemon', '');
                defer.resolve();
            }
        });
    } else {
        defer.resolve();
    }

    return defer.promise;    
};

// buster switch airplay
peppyScreensaver.prototype.switch_Airplay = function (useAirplay) {
    const self = this;
    var defer = libQ.defer();

    if (fs.existsSync(AIRtmpl)){
        if (useAirplay) {
			if (!fs.existsSync(AIR)){
				fs.copySync(AIRtmpl, AIR); // copy orignal file
				var airplaydata = fs.readFileSync(AIR, 'utf8'); 
				airplaydata = airplaydata.replace('${device}', 'airplay');
				fs.writeFileSync(AIR, airplaydata);
			}
			// mount template
			self.mount_tmpl(AIR, AIRtmpl);
			
        } else {
			if (fs.existsSync(AIR)){
				//unmount air_tmpl file, if mounted
				self.unmount_tmpl(AIRtmpl)
					.then(function() {fs.removeSync(AIR);});
			}
        }
        
        // restart airplay, if running
        if (self.getPluginStatus ('music_service', 'airplay_emulation') === 'STARTED'){
            var cmdret = self.commandRouter.executeOnPlugin('music_service', 'airplay_emulation', 'startShairportSync', '');
        }
		defer.resolve();
    } else {
        defer.resolve();
    }

    return defer.promise;
};
    
// buster callback if mixer or outputdevice changed
// update of asound template
peppyScreensaver.prototype.switch_alsaModular = function () {
    const self = this;

    setTimeout(function () {
        var outputdevice = self.getAlsaConfigParam('outputdevice');
        var softmixer = self.getAlsaConfigParam('softvolume');
        // only if outputdevice or mixer changed
        if (last_outputdevice !== outputdevice || last_softmixer !== softmixer) {
            var alsaConf = parseInt(self.config.get('alsaSelection'),10);
            if (alsaConf == 0) { // and only for modular alsa      
                self.writeAsoundConfigModular(alsaConf).then(self.updateALSAConfigFile.bind(self));
            }                
        }
        last_outputdevice = outputdevice;
        last_softmixer = softmixer;
    }, 500 );
};

// check, if Pygame 2 with SDL2 installed)
peppyScreensaver.prototype.get_SDL2_enabled = function (data) {
    const self = this;
    var defer = libQ.defer();
  
    var python_str = 'python3 -c "import pygame"'   

    exec(python_str, { uid: 1000, gid: 1000 }, function (error, stdout, stderr) {
    if (error) {
        self.logger.warn(id + 'An error occurred on pygame check', error);
    } else {
        if (stdout.includes('pygame 2.')) {
            defer.resolve(true);
            return true;
        } else {
            defer.resolve(false);
            return false;
        }            
    }
  });
    return defer.promise;
};
                         
// check, if MPD output enabled
peppyScreensaver.prototype.get_output_enabled = function (data) {
    const self = this;
    var defer = libQ.defer();
    var found = false;
    var count = 0;
       
    lineReader.eachLine(data, function(line) {
  
        if (line.includes('---> output peppymeter')) {
            found = true;
        }
        if (found) {count += 1;}

        if (count === 3) {
            if (line.includes('no')) {
                defer.resolve (false);
                return false
            } else {
                defer.resolve (true);
                return true
            }
        }           
    })
    return defer.promise;
};

// enable the MPD output for peppymeter 
peppyScreensaver.prototype.MPD_setOutput = function (data, enableDSD) {
  const self = this;
  let defer = libQ.defer();
  var sedStr = enableDSD ? "sed -i '/---> output peppymeter/,+2{/---> output peppymeter/,+1{b};s/no/yes/}' " : "sed -i '/---> output peppymeter/,+2{/---> output peppymeter/,+1{b};s/yes/no/}' ";

  exec(sedStr +  data, { uid: 1000, gid: 1000 }, function (error, stdout, stderr) {
    if (error) {
        self.logger.warn(id + 'An error occurred when change MPD output', error);
    } else {
        setTimeout(function () {defer.resolve();}, 100);
    }
  });

  return defer.promise;
};


// inject additional include file to mpd.conf.tmpl
peppyScreensaver.prototype.add_mpd_include = function (data) {
  const self = this;
  let defer = libQ.defer();

    var MPDdata = fs.readFileSync(data, 'utf8'); 
    if (!MPDdata.includes('include_optional')){
            
        exec("sed -i '/# Files and directories/a include_optional    \x22\/data\/configuration\/music_service\/mpd\/mpd_custom.conf\x22' " + data, { uid: 1000, gid: 1000 }, function (error, stdout, stderr    ) {
            if (error) {
                self.logger.warn(id + 'An error occurred when add MPD include entry', error);
            } else {
                setTimeout(function () {defer.resolve();}, 100);
            }       
        });
    } else {
        defer.resolve();
    }
                
  return defer.promise;
};

peppyScreensaver.prototype.rebootMessage = function () {
  var self = this;
  var responseData = {
    title: self.commandRouter.getI18nString('PEPPY_SCREENSAVER.MPD_CHANGED'),
    message: self.commandRouter.getI18nString('PEPPY_SCREENSAVER.MPD_CHANGED_REBOOT'),
    size: 'lg',
    buttons: [
        {
          name: self.commandRouter.getI18nString('COMMON.RESTART'),
          class: 'btn btn-info',
          emit: 'reboot',
          payload: ''
        },
      {
        name: self.commandRouter.getI18nString('COMMON.CONTINUE'),
        class: 'btn btn-info',
        emit: 'closeModals',
        payload: ''
      }
    ]
  };

  self.commandRouter.broadcastMessage('openModal', responseData);
};

//mount a copy of changed file over 
peppyScreensaver.prototype.mount_tmpl = function (data_source, data_dest) {
  var self = this;
  var defer = libQ.defer();
  
  exec('/bin/df ' + data_dest + ' | /bin/grep ' + data_dest + ' && /bin/echo || /bin/echo volumio | /usr/bin/sudo -S /bin/mount --bind ' + data_source + ' ' + data_dest, function (error, stdout, stderr) {        
    if (error) {
        self.logger.error(id + 'Error mount ' + data_source + ' ' + error);
    } else {
        defer.resolve();
    }    
  });        
  
  return defer.promise;
};

//unmount a copy of changed file
peppyScreensaver.prototype.unmount_tmpl = function (data_dest) {
  var self = this;
  var defer = libQ.defer();

  exec('/bin/df ' + data_dest + ' | /bin/grep ' + data_dest + ' && /bin/echo volumio | /usr/bin/sudo -S /bin/umount ' + data_dest, { uid: 1000, gid: 1000 }, function (error, stdout, stderr) {        
    if (error) {
        self.logger.error(id + 'Error unmount ' + data_dest + ' ' + error);
    } else {
        defer.resolve();
    }    
  });        
  
  return defer.promise;
};

// restart MPD-deamon
peppyScreensaver.prototype.restartMpd = function () {
  var self = this;
  var defer = libQ.defer();

  setTimeout(function () {
    self.commandRouter.executeOnPlugin('music_service', 'mpd', 'restartMpd', '');
    defer.resolve();
  }, 500);

  return defer.promise;
};

// copy MPD_include file
peppyScreensaver.prototype.copy_MPD_include = function (data, data_dest) {
  var self = this;
  var defer = libQ.defer();
  
  try {

    fs.copySync(data, data_dest);
  
    exec('/bin/chmod 777 ' + data_dest, function (error, stdout, stderr) {        
        if (error) {
            self.logger.error(id + 'Error chmod ' + data_dest + ' ' + error);
        } else {
            defer.resolve();
        }    
    });        

  } catch (err) {
    defer.resolve();
  }
  
  return defer.promise;
};

// recreate active /etc/mpd.conf
peppyScreensaver.prototype.recreate_mpdconf = function () {
  const self = this;
  let defer = libQ.defer();
  
  self.commandRouter.executeOnPlugin('music_service', 'mpd', 'createMPDFile', function(error) {
    if (error) {
        self.logger.error(id + 'Cannot create /etc/mpd.conf ' + error);
    } else {
        defer.resolve();
    }
  });
  return defer.promise;
};

// buster write asound.conf from template and remove variables
peppyScreensaver.prototype.writeAsoundConfigModular = function (alsaConf) {
  var self = this;
  var asoundTmpl = __dirname + asound + '.tmpl';
  var asoundConf = __dirname + '/asound' + asound;
  var conf;
  var defer = libQ.defer();
  var useDSP = fs.existsSync(dsp_config) && self.config.get('useDSP');
  var plugType = self.config.get('useUSBDAC') ? 'copy' : 'empty';
  var useSpot = self.config.get('useSpotify');

  if (fs.existsSync(asoundTmpl)) {
    var asounddata = fs.readFileSync(asoundTmpl, 'utf8');
    
    if (alsaConf == 1) { // DSD native
        if (!useDSP) {
            conf = asounddata.replace('${alsaDirect}', 'Peppyalsa');
        }

    } else {  // modular alsa                  
        conf = asounddata.replace('${alsaMeter}', 'Peppyalsa');
    }

    conf = conf.replace('${alsaMeter}', 'peppy1_off');
    conf = conf.replace('${alsaDirect}', 'peppy2_off');
    conf = conf.replace('${type}', plugType);

    //for spotify
    if (!useDSP) {
        if (useSpot){
            conf = conf.replace('${spotMeter}', 'spotify');
        } else {
            conf = conf.replace('${spotDirect}', 'spotify');
        }
    }
    conf = conf.replace('${spotMeter}', 'spotify2_off');
    conf = conf.replace('${spotDirect}', 'spotify1_off');
        
    // change alsa config depend on outputdevice and mixer
    // no reformat possible for softmixer
    // for internal cards (hdmi, headphone) 44100 kHz
    // for external sound cards 16000 kHz (the only rate without error)
    // removed since 3.569
    //var outputdevice = self.getAlsaConfigParam('outputdevice');
    //var softmixer = self.getAlsaConfigParam('softvolume');
        
    //if (outputdevice == 'softvolume') {
    //    outputdevice = self.getAlsaConfigParam ('softvolumenumber');
    //}

//    var slave_b = softmixer ? 'mpd_peppyalsa' : 'reformat'; 
//    conf = conf.replace('${slave_b}', slave_b);            
//    var rate = parseInt(outputdevice,10) > 1 ? 16000 : 44100;
//    conf = conf.replace('${rate}', rate);    
        
    fs.writeFile(asoundConf, conf, 'utf8', function (err) {
        if (err) {
            self.logger.info('Cannot write ' + asoundConf + ': ' + err);
        } else {
            //self.logger.info(asoundConf + ' file written');
            if (fs.existsSync(spotify_config) && self.getPluginStatus ('music_service', 'spop') === 'STARTED'){
                var cmdret = self.commandRouter.executeOnPlugin('music_service', 'spop', 'initializeLibrespotDaemon', '');            
            }
            defer.resolve();
        }
    });
  }

return defer.promise;  
};



peppyScreensaver.prototype.getAlsaConfigParam = function (data) {
	var self = this;
	return self.commandRouter.executeOnPlugin('audio_interface', 'alsa_controller', 'getConfigParam', data);
};

peppyScreensaver.prototype.disableSoftMixer = function (data) {
	var self = this;
	return self.commandRouter.executeOnPlugin('audio_interface', 'alsa_controller', 'disableSoftMixer', data);
};

peppyScreensaver.prototype.writeSoftMixerFile = function (data) {
	var self = this;
	return self.commandRouter.executeOnPlugin('audio_interface', 'alsa_controller', 'writeSoftMixerFile', data);
};

peppyScreensaver.prototype.IfBuster = function () {
	var self = this; 
    return self.commandRouter.executeOnPlugin('system_controller', 'system', 'getConfigParam', 'system_version') < 3.0 ? false : true;
};

peppyScreensaver.prototype.updateALSAConfigFile = function () {
	var self = this;
    var defer = libQ.defer();
    self.commandRouter.executeOnPlugin('audio_interface', 'alsa_controller', 'updateALSAConfigFile');
    defer.resolve();
    return defer.promise;
};
    
//--------------------------------------------------------------

// called from commandrouter to find the language file
peppyScreensaver.prototype.getI18nFile = function (langCode) {
  const i18nFiles = fs.readdirSync(path.join(__dirname, 'i18n'));
  const langFile = 'strings_' + langCode + '.json';

  // check for i18n file fitting the system language
  if (i18nFiles.some(function (i18nFile) { return i18nFile === langFile; })) {
    return path.join(__dirname, 'i18n', langFile);
  }
  // return default i18n file
  return path.join(__dirname, 'i18n', 'strings_en.json');
};

peppyScreensaver.prototype.getConfigParam = function (key) {
  var self = this;
  return self.config.get(key);
};

peppyScreensaver.prototype.setConfigParam = function (data) {
  var self = this;
  self.config.set(data.key, data.value);
};

peppyScreensaver.prototype.getPluginStatus = function (category, name) {
  var self = this;
  
  var PlugInConfig = new (require('v-conf'))();
  PlugInConfig.loadFile(PluginConfiguration);
  var retStr = PlugInConfig.get(category + '.' + name + '.status');
  retStr = typeof retStr === 'undefined' ? 'null' : retStr;
  return retStr;  
};
//-------------------------------------------------------------

peppyScreensaver.prototype.setUIConfig = function(data) {
	var self = this;
	//Perform your installation tasks here
};

peppyScreensaver.prototype.getConf = function(varName) {
	var self = this;
	//Perform your installation tasks here
};

peppyScreensaver.prototype.setConf = function(varName, varValue) {
	var self = this;
	//Perform your installation tasks here
};

//--------------------------------------------------------------
// unused procedures --> to delete
//--------------------------------------------------------------

// update the mountpoint after change the copied file ---> to delete
peppyScreensaver.prototype.updateMountpoint = function (data_source, data_dest) {
  var self = this;
  var defer = libQ.defer();

    try {
        execSync('/bin/df ' + data_dest + ' | /bin/grep ' + data_dest + ' && /bin/echo volumio | /usr/bin/sudo -S /bin/umount ' + data_dest);
        execSync('/bin/df ' + data_dest + ' | /bin/grep ' + data_dest + ' && /bin/echo || /bin/echo volumio | /usr/bin/sudo -S /bin/mount --bind ' + data_source + ' ' + data_dest);
        defer.resolve();
    } catch (err) {
        self.logger.error(id + 'Cannot update mpd mountpoint');
    }
    
  return defer.promise;
};

// buster enable the MPD allowed_formats --- to delete
peppyScreensaver.prototype.MPD_allowedFormats = function (data, enableDSD) {
  const self = this;
  let defer = libQ.defer();
  
  // remove old entry
  exec("sed -i '/allowed_formats/d' " + data, { uid: 1000, gid: 1000 }, function (error, stdout, stderr) {
    if (error) {
        self.logger.warn(id + 'An error occurred when change allowed formats MPD', error);
    } else {
        // add new entry for alsa pipeline
        setTimeout(function () {
            if (!enableDSD) {
                exec("sed -i '/${special_settings}/a allowed_formats\t\x22192000:*:* 96000:*:* 88200:*:* 48000:*:* 44100:*:* 32000:*:* 16000:*:*\x22' " + data, { uid: 1000, gid: 1000 }, function (error, stdout, stderr) {
                    if (error) {
                        self.logger.warn(id + 'An error occurred when change allowed formats MPD', error);
                    } else {
                        setTimeout(function () {defer.resolve();}, 100);
                    }       
                });
            } else {
                defer.resolve();
            }
        }, 100);
    }
  });

  return defer.promise;
};

// inject additional output for peppymeter to mpd.conf.tmpl ---> to delete
peppyScreensaver.prototype.add_mpdoutput = function (data) {
  const self = this;
  let defer = libQ.defer();

  var insertStr = '"\
#---> output peppymeter\\n\
audio_output {\\n\
        enabled     \\x22yes\\x22\\n\
        type        \\x22alsa\\x22\\n\
        name        \\x22mpd_peppyalsa\\x22\\n\
        device      \\x22mpd_peppyalsa\\x22\\n\
        dop         \\x22yes\\x22\\n\
        mixer_type  \\x22none\\x22\\n\
        format      \\x2244100:16:2\\x22\\n\
}\\n\
#<--- end peppymeter"';
  
  exec("awk 'NR==FNR{if ($0 ~ /multiroom/){c=NR};next} {if (FNR==(c-4)) {print " + insertStr + " }};1' " +  data + " " + data + " > " + data + "_tmp && mv " + data + "_tmp " + data, { uid: 1000, gid: 1000 }, function (error, stdout, stderr) {
    if (error) {
        self.logger.warn(id + 'An error occurred when creating inject', error);
    } else {
        setTimeout(function () {defer.resolve();}, 100);
    }
  });
  return defer.promise;
};

// remove injected additional output for peppymeter from mpd.conf.tmpl ---> to delete
peppyScreensaver.prototype.del_mpdoutput = function (data) {
  const self = this;
  let defer = libQ.defer();

  exec("sed -n -i '/---> output peppymeter/,/<--- end peppymeter/!p' " + data, { uid: 1000, gid: 1000 }, function (error, stdout, stderr) {
    if (error) {
        self.logger.warn(id + 'An error occurred when remove inject' + error);
    } else {
        setTimeout(function () {defer.resolve();}, 100);
    }
  });
  return defer.promise;
};

// jessie redirect standard output to mpd_alsa ---> to delete
peppyScreensaver.prototype.redirect_mpdoutput = function (data) {
  const self = this;
  let defer = libQ.defer();
  
  var mpddata = fs.readFileSync(data, 'utf8');
  mpddata = mpddata.replace('${device}', 'mpd_alsa');
  fs.writeFile(data, mpddata, 'utf8', function (error) {
    if (error) {
        self.logger.error(id + 'Cannot write ' + data + ': ' + error);
    } else {
        self.logger.info(id + 'mpd.conf.tmpl file written');
        defer.resolve();
    }
  });
  return defer.promise;
};

// jessie modify airplay output ---> to delete
peppyScreensaver.prototype.redirect_airoutput = function (data) {
  const self = this;
  let defer = libQ.defer();
  
  var airdata = fs.readFileSync(data, 'utf8');
  airdata = airdata.replace('${device}', 'peppyalsa');
  fs.writeFile(data, airdata, 'utf8', function (error) {
    if (error) {
        self.logger.error(id + 'Cannot write ' + data + ': ' + error);
    } else {
        self.logger.info(id + 'shairport-sync.conf.tmpl file written');
        defer.resolve();
    }
  });
  return defer.promise;
};  

// create asound depend on mixer type ---> to delete
peppyScreensaver.prototype.createAsoundConfig = function () {
  var self = this;  
  var defer = libQ.defer();
  
  // wait a little bit until mixer_type is set
  setTimeout(function () {
    var mixer_type = self.getAlsaConfigParam('mixer_type');        
    var outputdevice = self.getAlsaConfigParam('outputdevice');

    //self.logger.info('______________________ ' + mixer_type);
    if (mixer_type === 'Software') {
        if (outputdevice == 'softvolume') {
            outputdevice = self.getAlsaConfigParam ('softvolumenumber');
        }
        fs.readFile('/etc/asound.conf', 'utf8', function (err, data) {
            if (err) {
                self.logger.error('Error reading /etc/asound.conf: ' + err);
            }
            self.writeAsoundConfig(outputdevice, true);
            defer.resolve();
        });

    } else {
        fs.readFile('/etc/asound.conf', 'utf8', function (err, data) {
            if (err) {
                self.logger.error('Error reading /etc/asound.conf: ' + err);
            }
            self.writeAsoundConfig(outputdevice, false);
            defer.resolve();
        });
    }
    //self.commandRouter.executeOnPlugin('music_service', 'mpd', 'restartMpd', '');
  }, 500);
  
  return defer.promise;
};

// write asound.conf from template and remove variables ---> to delete
peppyScreensaver.prototype.writeAsoundConfig = function (data, enableSoft) {
  var self = this;
  var asoundTempl = __dirname + '/asound.conf.tmpl';
  var conf, card, device;
  var defer = libQ.defer();
  
  if (fs.existsSync(asoundTempl)) {
    var asounddata = fs.readFileSync(asoundTempl, 'utf8');
    if ((data).indexOf(',') >= 0) {
        var dataarr = (data).split(',');
        card = dataarr[0];
        device = dataarr[1];
    } else {
        card = data;
        device = '0';
    }

    conf = asounddata.replace(/\${card}/g, card);
    conf = conf.replace(/\${device}/g, device);

    if (enableSoft) {
        conf = conf.replace('${snd_output_hard}', 'mpd_alsa_deakt');
        conf = conf.replace('${snd_output_soft}', 'mpd_alsa');
    } else {
        conf = conf.replace('${snd_output_hard}', 'mpd_alsa');
        conf = conf.replace('${snd_output_soft}', 'mpd_alsa_deakt');
    }

    fs.writeFile('/home/volumio/asoundrc_tmp', conf, 'utf8', function (err) {
        if (err) {
            self.logger.info('Cannot write /etc/asound.conf: ' + err);
        } else {
            try {
                self.logger.info('Asound.conf file written');
                var mv = execSync('/usr/bin/sudo /bin/mv /home/volumio/asoundrc_tmp /etc/asound.conf', { uid: 1000, gid: 1000, encoding: 'utf8' });
                var apply = execSync('/usr/sbin/alsactl -L -R nrestore', { uid: 1000, gid: 1000, encoding: 'utf8' });
            } catch (e) {
            }    
            defer.resolve();
        }
    });
  }

return defer.promise;  
};


// called from unistall script (only needed for Jessie) ---> to delete
// restore asound.conf
peppyScreensaver.prototype.restoreAsoundConfig = function () {
  var self = this;  
  var defer = libQ.defer();

  var msg_title, msg_msg, msg_name;
  
  // wait a little bit until mixer_type is set
  setTimeout(function () {
    var mixer_type = self.getAlsaConfigParam('mixer_type');        
    var outputdevice = self.getAlsaConfigParam('outputdevice');

    //self.logger.info('______________________ ' + mixer_type);
    if (mixer_type === 'Software') {
        if (outputdevice == 'softvolume') {
            outputdevice = self.getAlsaConfigParam ('softvolumenumber');
        }
        fs.readFile('/etc/asound.conf', 'utf8', function (err, data) {
            if (err) {
                self.logger.error('Error reading /etc/asound.conf: ' + err);
            }
            self.writeSoftMixerFile(outputdevice);
            defer.resolve();
        });

    } else {
        fs.readFile('/etc/asound.conf', 'utf8', function (err, data) {
            if (err) {
                self.logger.error('Error reading /etc/asound.conf: ' + err);
            }
            self.disableSoftMixer(outputdevice);
            defer.resolve();
        });
    }

    // create a hint as modal to reboot
    var responseData = {
      title: self.commandRouter.getI18nString('PEPPY_SCREENSAVER.UNINSTALL_TITLE'),
      message: self.commandRouter.getI18nString('PEPPY_SCREENSAVER.UNINSTALL_MSG'),
      size: 'lg',
      buttons: [
        {
          name: self.commandRouter.getI18nString('COMMON.GOT_IT'),
          class: 'btn btn-info ng-scope',
          emit: '',
          payload: ''
        }
      ]
    };
    self.commandRouter.broadcastMessage('openModal', responseData);


    //self.commandRouter.executeOnPlugin('music_service', 'mpd', 'restartMpd', '');
  }, 500);
  
  return defer.promise;
};
