# DebugPerfmon

Processwire module used in performance monitoring and optimization.

This module is intended to be run on a development machine. To prevent the module from  from mistakenly running in production, the module looks to Processwire's configuration and will only execute when debug is set to `true`.

The toolbar interface was inspired by the great [django-debug-toolbar](https://github.com/django-debug-toolbar/django-debug-toolbar).

## Overview

### Requirements

* PHP >=5.4 (uses REQUEST\_TIME\_FLOAT)
* Processwire >=2.5 

### Installation

1. drop the unzipped DebugPerfmon directory into site modules
2. set debug to true in your development site's configuration — `$config->debug = true;`. Use care not to leak this value into production (a local configuration override is a good idea).
2. login to the admin, go to modules, refresh and click install

You should immediately see the collapsed toolbar in the upper right of the screen.

### Limitations

MySQL timings start being captured with the module's initialization. This means MySQL activity occurring during bootstrap is not reported. If you have any ideas how to workaround the issue without modifying core, be sure to send an email.

Page historical data is stored in the browser's localStorage. Clearing the browser history will clear the DebugPerfmon history.

## Screencaps

A collapsed toolbar in the upper right hand corner of the screen.

![screencap](http://www.keene.edu/ksc/assets/files/26766/collapsed.png?rev2)

The expanded toolbar, viewing the timings panel.

![screencap](http://www.keene.edu/ksc/assets/files/26766/timings.png?rev2)