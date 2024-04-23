# Copyright 2024 PeppyMeter for Volumio by 2aCD
# 
# This file is part of PeppyMeter for Volumio
# 

import pygame as pg
import time
import ctypes
# import pygame as pg

from socketIO_client import SocketIO
from threading import Thread

from configfileparser import METER, RANDOM_METER_INTERVAL, SCREEN_RECT, UI_REFRESH_PERIOD
from volumio_configfileparser import METER_BKP, RANDOM_TITLE, METER_VISIBLE
  
class RandomControl(Thread):
    """ Provides show albumart in a separate thread """
    
    def __init__(self, util, meter_config_volumio, meter):
        """ Initializer
        """
        Thread.__init__(self)

        self.meter = meter
        self.util = util
        self.meter_config = self.util.meter_config
        self.meter_config_volumio = meter_config_volumio

        self.run_flag = True
        self.first_run = True
        self.title_mem = ""
        self.random_meter = False
        self.list_meter = False
        
        # config values
        self.random_meter_interval = int(self.meter_config[RANDOM_METER_INTERVAL])
        self.random_title = self.meter_config_volumio[RANDOM_TITLE]
        if self.meter_config_volumio[METER_BKP] == "random":
            self.random_meter = True
        elif "," in self.meter_config_volumio[METER_BKP]:
            self.list_meter = True

        self.seconds = 0                    
        
    def run(self):
        """ Thread method. show all title infos and albumart. """
        
        def meter_restart(): 
        
            screen = self.meter.util.PYGAME_SCREEN
            screen_rect = self.meter_config[SCREEN_RECT]
            
            vol = 0.0
                    
            def updateFade(img, a):
                img.set_alpha(a)
                screen.blit(img, screen_rect)
                pg.display.update(screen_rect)
            
            # stop meter animation
            self.meter.stop()
            time.sleep(0.2) # wait for threads finshed
            
            # start meter animation to temporary surface
            # use internal functions to prevent callback
            # start with volume 0 for fadeIn
            self.meter.util.PYGAME_SCREEN = screen.copy()
            self.meter.meter = self.meter.get_meter()
            self.meter.meter.set_volume(vol)
            self.meter.meter.start()            
            screen_new = self.meter.util.PYGAME_SCREEN.copy()
            
            # fadeIn new screen to old
            meter_section_meter = self.meter_config[self.meter_config[METER]]
            alpha = 20
            while alpha < 120:
                updateFade(screen_new, alpha)
                time.sleep(meter_section_meter[UI_REFRESH_PERIOD])
                alpha += 7            
            updateFade(screen_new, 255)

            # restore default screen to pygame screen for all components
            self.meter.util.PYGAME_SCREEN = screen
            
            # start albunart
            if hasattr(self, "callback_start"):
                self.callback_start(self.meter.meter)

            self.meter_section_volumio = self.meter_config_volumio[self.meter_config[METER]]
            if self.meter_section_volumio[METER_VISIBLE] == True:            
                # restore screen screen for meters
                for comp in self.meter.meter.components:
                    comp.screen = screen

                # volume fadeIn for meters
                while vol <= self.meter.current_volume:
                    self.meter.meter.set_volume(vol)
                    vol += 10
                    time.sleep(0.05)
                    
        def on_push_state(*args):
            #print (args[0]['status'] + args[0]['title'])
            if args[0]['status'] == 'play' and args[0]['title'] != self.title_mem:
                if not self.first_run:
                    meter_restart()     # own restart fadeIn
                    #self.meter.restart() # vumeter restart

                self.title_mem = args[0]['title']
                #print('change')

            self.first_run = False
                
        def on_connect():
            #print('connect')
            if self.random_title:
                socketIO.on('pushState', on_push_state)
                socketIO.emit('getState', '', on_push_state)

        if self.random_meter or self.list_meter:
            socketIO = SocketIO('localhost', 3000)
            socketIO.once('connect', on_connect)
            
            # wait while run_flag true 
            while self.run_flag:

                # start random with random interval
                if not self.random_title:
                    if self.seconds == self.random_meter_interval:
                        self.seconds = 0
                        meter_restart()     # own restart fadeIn
                        #self.meter.restart() # vumeter restart
                    self.seconds += 1
            
                socketIO.wait(1)		

            # on exit
            socketIO.disconnect()
            del socketIO
        
        # cleanup memory
        del self.meter
        del self.util
        del self.meter_config
        del self.meter_config_volumio
        self.trim_memory()
        #print('exit -->')
        
    def stop_thread(self):
        """ Stop thread """

        self.run_flag = False


    # cleanup memory on exit
    def trim_memory(self) -> int:
        libc = ctypes.CDLL("libc.so.6")
        return libc.malloc_trim(0)
            
# ===================================================================================================================	