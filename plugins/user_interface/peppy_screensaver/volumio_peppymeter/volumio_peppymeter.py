# Copyright 2024 PeppyMeter for Volumio by 2aCD
# 
# This file is part of PeppyMeter for Volumio
# 

import os, sys
import time
import ctypes
import resource
import pygame as pg
from pathlib import Path
from threading import Thread

from peppymeter.peppymeter import Peppymeter
from configfileparser import METER

from volumio_albumart import AlbumartAnimator
from volumio_spectrum import SpectrumOutput
from volumio_random import RandomControl
from volumio_configfileparser import Volumio_ConfigFileParser, EXTENDED_CONF, METER_VISIBLE, SPECTRUM_VISIBLE

PeppyRunning = '/tmp/peppyrunning'
CurDir = os.getcwd()
PeppyPath = CurDir + '/screensaver/peppymeter'

class CallBack:
    """ Implements CallBack functions to start and stop albumart/spectrum animator """
    
    def __init__(self, util, meter_config_volumio):
        """ Initializer

        :param util: peppymeter utility class
        :param meter_config_volumio: volumio meter configuration
        """

        self.util = util
        self.meter_config = self.util.meter_config
        self.meter_config_volumio = meter_config_volumio
        
        
    def peppy_meter_start(self, meter):
        # print('start')
        self.meter_section = self.meter_config_volumio[self.meter_config[METER]]        
        
        # start albumart animator
        self.album_animator = None
        self.album_animator = AlbumartAnimator(self.util, self.meter_config_volumio)
        self.album_animator.start()

        if self.meter_section[EXTENDED_CONF] == True:
            # stop meters when they are not visible
            if self.meter_section[METER_VISIBLE] == False:
                meter.stop()
        
            # start spectrum thread if visible
            if self.meter_section[SPECTRUM_VISIBLE] == True:
                self.spectrum_output = None
                self.spectrum_output = SpectrumOutput(self.util, self.meter_config_volumio, CurDir)
                self.spectrum_output.start()
        
            # print (self.get_memory() / 1024)
    
    def peppy_meter_stop(self, meter):
        # print('stop')
        # stop albumart animator, if is running
        if hasattr(self, 'album_animator') and self.album_animator is not None:
            self.album_animator.stop_thread()
            del self.album_animator
        
        # stop spectrum, if running
        if hasattr(self, 'spectrum_output') and self.spectrum_output is not None:
            self.spectrum_output.stop_thread()
            del self.spectrum_output

    def peppy_meter_update(self):
        if hasattr(self, 'spectrum_output') and self.spectrum_output is not None:
            self.spectrum_output.update()    
    
    def get_memory(self):
        with open('/proc/meminfo', 'r') as mem:
            free_memory = 0
            for i in mem:
                sline = i.split()
                #if str(sline[0]) in ('MemFree:', 'Buffers:', 'Cached:'):
                if str(sline[0]) in ('MemAvailable:'):
                    free_memory += int(sline[1])
        return free_memory
    
    # cleanup memory called on stop
    def trim_memory(self) -> int:
        libc = ctypes.CDLL("libc.so.6")
        return libc.malloc_trim(0)

    # cleanup memory called on stop
    def exit_trim_memory(self):
            
        # cleanup    
        if os.path.exists(PeppyRunning):
            os.remove(PeppyRunning)
                
        del self.album_animator
        del self.util
        self.trim_memory()

# end class callback ----------------------------------------------

def meter_thread(arg):
    pm = arg
    pm.init_display()
    pm.start_display_output()
        
def memory_limit():
    soft, hard = resource.getrlimit(resource.RLIMIT_AS)
    free_memory = get_memory() * 1024
    resource.setrlimit(resource.RLIMIT_AS, (free_memory + 90000000, hard))
    # print(free_memory / 1024 /1024)
           
def get_memory():
    with open('/proc/meminfo', 'r') as mem:
        free_memory = 0
        for i in mem:
            sline = i.split()
            #if str(sline[0]) in ('MemFree:', 'Buffers:', 'Cached:'):
            if str(sline[0]) in ('MemAvailable:'):
                free_memory += int(sline[1])
    return free_memory

# cleanup memory on exit
def trim_memory() -> int:
    libc = ctypes.CDLL("libc.so.6")
    return libc.malloc_trim(0)
        
if __name__ == "__main__":
    """ This is called by Volumio """

    #enable threading!! 
    ctypes.CDLL('libX11.so.6').XInitThreads()
    
    # get the peppy meter object
    os.chdir(PeppyPath) # to find the config file
    pm = Peppymeter(standalone=True, timer_controlled_random_meter=False)
    
    # parse additional volumio configuration values  
    parser = Volumio_ConfigFileParser(pm.util)   
    meter_config_volumio = parser.meter_config_volumio
    
    # define the callback functions
    callback = CallBack(pm.util, meter_config_volumio)
    pm.meter.callback_start = callback.peppy_meter_start
    pm.meter.callback_stop = callback.peppy_meter_stop
    pm.dependent = callback.peppy_meter_update
    pm.meter.malloc_trim = callback.trim_memory
    pm.malloc_trim = callback.exit_trim_memory
            
    # start display output until break       
    memory_limit() # Limitates maximun memory usage
    try:
        Path(PeppyRunning).touch()
        Path(PeppyRunning).chmod(0o0777)
     
        # start random control in separate thread
        Random_Control = RandomControl(pm.util, meter_config_volumio, pm.meter)
        Random_Control.callback_start = callback.peppy_meter_start
        Random_Control.start()
        
        # start meter output in separate thread
        meter_output = Thread(target = meter_thread, args=(pm, ))
        meter_output.start()
                
        # stop if PeppyRunning deleted from external script
        while os.path.exists(PeppyRunning):
            time.sleep(1)
        pg.event.post(pg.event.Event(pg.MOUSEBUTTONUP))
        
    except MemoryError:
        print('ERROR: Memory Exception')
        callback.exit_trim_memory()
        del pm
        del callback
        trim_memory()            
        if os.path.exists(PeppyRunning):
            os.remove(PeppyRunning)
        os._exit(1)
