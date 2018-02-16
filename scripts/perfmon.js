/* Copyright 2014-2018, Keene State College 
Released under MIT license: http://opensource.org/licenses/MIT */

"use strict";

(function(){

window.perfmon = {};

// perfmon.data is populated from a javascript after this is loaded
perfmon.data = {};
perfmon.elements = {};
perfmon.open = false;
perfmon.scopes = [];

perfmon.charts = {};
perfmon.rendered = false;

// *************************************************************************************************

perfmon.utils = {};

perfmon.utils.millis = function(seconds){
    return (seconds * 1000).toFixed(2);
};

perfmon.utils.chart = {};

perfmon.utils.chart.modbound = function(max, mod){
    return (max - (max%mod) + mod);
};

perfmon.utils.chart.map = function(series) {
  series.values = series.values.map(function(d) { return {x: d[0], y: d[1] } });
  return series;
};

perfmon.utils.chart.widths = function() {
    var cwidth = perfmon.utils.chart.width();
    for (var key in perfmon.charts){
        var c = perfmon.charts[key].object;
        if(c){
            c.width(cwidth);
            c.update();
        }
    }
};

perfmon.utils.chart.width = function() {
  return $('#perfmon .chart:visible:first-child').width();
};

perfmon.utils.chart.resize = function(chart) {
    nv.utils.windowResize(function(){
        var cwidth = perfmon.utils.chart.width();
        chart.width(cwidth);
        chart.update();
    });
};

// *************************************************************************************************

// local storage wrangling
perfmon.ls = {};
perfmon.ls.id = 'perfmon';
perfmon.ls.schema = '0.3';
perfmon.ls.memo = null;
perfmon.ls.history = 1000;

perfmon.ls.supported = function(){
    try {
        localStorage.setItem('test', 1);
        localStorage.removeItem('test');
        return true;
    } catch(e) {
        return false;
    }
};

perfmon.ls.get = function(){
    
    var data;
    
    // memoized copy, return if not stale
    if(perfmon.ls.memo){
        return perfmon.ls.memo;
    }
    
    // else wrangle localStorage
    var lsd = localStorage.getItem(perfmon.ls.id);
    if(!lsd){
        data = {
           schema: perfmon.ls.schema
        }
    }else{
        data = JSON.parse(lsd);
        // clear history if store has been altered
        if (data.schema != perfmon.ls.schema){
            localStorage.clear();
            return perfmon.ls.get();
        }
    }
    
    perfmon.ls.memo = data;
    return data;
    
};

perfmon.ls.set = function(request_time, template_time, query_time, query_count, hook_count){
    perfmon.ls.memo = null;
    var data = perfmon.ls.get();
    var path = document.location.pathname;
    if (!(path in data)){
        data[path] = {};
    }
    
    // using int millis uses less storage than float seconds
    data[path][new Date().getTime()] = [
        Math.round(request_time * 1000),
        Math.round(template_time * 1000),
        Math.round(query_time * 1000),
        query_count,
        hook_count
    ];
    
    // just so things don't get out of control, constrain history
    var val = data[path];
    if(typeof(val) == 'object' && Object.keys(val).length > perfmon.ls.history){
        var remove = Math.ceil(perfmon.ls.history * 0.01);
        var keys = Object.keys(val).sort();
        var iter = 0;
        for(var i=0, l=keys.length; i<l; i++){
            var key = keys[i];
            delete val[key];
            if (++iter >= remove){
                break;
            }
        }
    }
    
    
    localStorage.setItem(perfmon.ls.id, JSON.stringify(data));
    return undefined;
    
};
perfmon.ls.state = function(open){
    var data = perfmon.ls.get();
    data.open = open;
    localStorage.setItem(perfmon.ls.id, JSON.stringify(data));
    return undefined;
};

// *************************************************************************************************

perfmon.init = function(data){
    
    // bail out if the browser is not supported
    if (!(perfmon.ls.supported() && document.implementation.hasFeature("http://www.w3.org/TR/SVG11/feature#Image", "1.1"))){
        var msg = 'Perfmon Toolbar is not supported for this browser -- localStorage and SVG are required.'
        if('console' in window){
            console.warn(msg);
        }else{
            // this is too annoying for IE8, but how to warn?
            //alert(msg);
        }
        return;
    }
    
    // set timings to object
    perfmon.data = data;
    
    var sqlr = perfmon.sql_time();
    var rt = perfmon.request_time();
    var tt = perfmon.template_time();
    
    // need to wait for initialization to set these
    perfmon.scopes = [
      {
        name:'time', 
        title:'Time', 
        synopsis: ['Total: ', perfmon.utils.millis(rt),'<span class="ms">MS</span>'].join('')
      },
      {
        name:'sql', 
        title:'SQL',
        synopsis: [sqlr.total_queries,'<sup>&dagger;</sup> queries in ', perfmon.utils.millis(sqlr.total_time),'<span class="ms">MS</span>'].join('')
      },
      {
        name:'hooks', 
        title:'Hooks',
        synopsis: ['Total: ', perfmon.data.hooks.length].join('')
      },
      {
        name:'versions', 
        title:'Versions',
        synopsis: ['PHP ', perfmon.data.versions.php,'/PW ', perfmon.data.versions.processwire].join('')
      },
    ];
    
    // set history
    perfmon.ls.set(rt, tt, sqlr.total_time, sqlr.total_queries, perfmon.data.hooks.length);
    
    var output = [];
    
    perfmon.elements.handle = perfmon.render.handle();
    perfmon.elements.toolbar = perfmon.render.toolbar();
    perfmon.elements.panels = perfmon.render.panels();
    perfmon.elements.main = $('<div id="perfmon" style="display:none"></div>');
    perfmon.elements.main.append(perfmon.elements.handle);
    perfmon.elements.main.append(perfmon.elements.toolbar);
    perfmon.elements.main.append(perfmon.elements.panels);
    $('body').append(perfmon.elements.main);
    
    var ls = perfmon.ls.get();
    if (ls.open){
        perfmon.elements.toolbar.hide();
        perfmon.toggle();
    }
    
    // handle FOUC - stylesheet loader, when all stylesheets are loaded show() toolbar
    var loader = {
        count: perfmon.data.stylesheet.length,
        sheets: {}
    };
    
    // add styles and affix onload callback to keep track of loaded sheets
    for(var i=0, len=loader.count; i < len; i++){
        var href = perfmon.data.stylesheet[i];
        loader.sheets[href] = false;
        var stylesheet = $('<link rel="stylesheet" type="text/css" href="'+href+'">');
        stylesheet.on("load", function(){
            loader.sheets[this.getAttribute("href")] = true;
            var values = $.map(loader.sheets, function(v){ return v;});
            if(loader.count === values.length && values.indexOf(false) === -1){
                perfmon.elements.main.show();
            }
        });
        $('head').append(stylesheet);
    }
    
};

// *************************************************************************************************

perfmon.request_time = function(){
    var request = perfmon.data.timings.request;
    var request_time = (request.end - request.start);
    return request_time;
}

perfmon.template_time = function(){
    var request = perfmon.data.timings.request;
    var request_time = (request.end - request.template);
    return request_time;
}

perfmon.sql_time = function(){
    
    var sqlt = perfmon.data.timings.sql;
    var total_time = 0;
    var total_requests = 0;
    
    for(var i=0, l=sqlt.length;i<l;i++){
        total_time += sqlt[i].time;
    }
    
    var result = {}
    result.total_queries = i;
    result.total_time = total_time;
    
    return result;
    
}
// *************************************************************************************************

perfmon.panels = {};

// *************************************************************************************************

perfmon.panels.hooks = function(){
    
    var output = [];
    
    output.push('<div class="chart" id="hookschart"><svg></svg></div>');
    output.push('<div id="sqltable">');
    output.push('  <table>');
    output.push('   <thead>');
    output.push('     <tr><th>Priority</th><th>Class::Method</th><th>After</th><th>Before</th></tr>');
    output.push('    </thead>');
    output.push('   <tbody>');
    
    var hooks = perfmon.data.hooks;
    for(var i=0, l=hooks.length;i<l;i++){
        var row = hooks[i];
        output.push('<tr><td>', row.priority,'</td><td>',row.class,'::',row.method,'</td><td>',(row.before ? '&#10003;' : ''),'</td><td>', (row.after ? '&#10003;' : ''),'</td></tr>');
    }
    
    output.push('   </tbody>');
    output.push('  </table>');
    output.push('</div>');
    
    return output.join('');
    
};

// *************************************************************************************************

perfmon.panels.time = function(){
    
    var request = perfmon.request_time();
    var template = perfmon.template_time();
    var output = [];
    
    output.push('<div class="chart" id="timechart"><svg></svg></div>');
    output.push('<div id="timetable">');
    
    output.push('  <table>');
    output.push('   <thead>');
    output.push('     <tr><th>Response</th><th>Time</th></tr>');
    output.push('    </thead>');
    output.push('   <tbody>');
    output.push('     <tr><td>Bootstrap</td><td>', perfmon.utils.millis((request - template)),'<span class="ms">MS</span></td></tr>');
    output.push('     <tr><td>Template</td><td>', perfmon.utils.millis(template),'<span class="ms">MS</span></td></tr>');
    output.push('   </tbody>');
    output.push('   <tfoot>');
    output.push('     <tr><td>Total</td><td>', perfmon.utils.millis(request),'<span class="ms">MS</span></td></tr>');
    output.push('   </tfoot>');
    output.push('  </table>');
    
    output.push('  <br/>');
    output.push('  <table>');
    output.push('   <thead>');
    output.push('     <tr><th>Named Timer</th><th>Time</th></tr>');
    output.push('    </thead>');
    output.push('   <tbody>');
    
    var custom = perfmon.data.timings.custom;
    for(var c in custom){
        var trimmed = c.length > 128 ? c.substr(0,128) + "&hellip;" : c;
        output.push('<tr><td>', trimmed,'</td><td>',perfmon.utils.millis(custom[c]),'<span class="ms">MS</span></td></tr>');
    }    
    
    output.push('   </tbody>');
    output.push('  </table>');
    
    output.push('</div>');
    
    return output.join('');
    
};
// *************************************************************************************************

perfmon.panels.versions = function(){
    
    var request = perfmon.request_time();
    var template = perfmon.template_time();
    var output = [];
    
    output.push('<div id="versionstable">');
    
    output.push('  <table>');
    output.push('   <thead>');
    output.push('     <tr><th>PHP Module</th><th>Version</th></tr>');
    output.push('    </thead>');
    output.push('   <tbody>');
    
    var modules = perfmon.data.versions.phpext;
    for(var i=0, l=modules.length; i<l; i++){
        var row = modules[i];
        output.push('<tr><td>', row[0],'</td><td>', row[1],'</td></tr>');
    }
    
    output.push('   </tbody>');
    output.push('  </table>');
    
    output.push('  <table>');
    output.push('   <thead>');
    output.push('     <tr><th>Processwire Module</th><th>Version</th></tr>');
    output.push('    </thead>');
    output.push('   <tbody>');
    
    var modules = perfmon.data.versions.modules;
    for(var i=0, l=modules.length; i<l; i++){
        var row = modules[i];
        output.push('<tr><td>', row[0],'</td><td>', row[1],'</td></tr>');
    }
    
    output.push('   </tbody>');
    output.push('  </table>');
    output.push('<div style="clear:both"></div>');
    output.push('</div>');
    
    return output.join('');
    
};
// *************************************************************************************************

perfmon.panels.sql = function(parent){
    
    var sqlt = perfmon.data.timings.sql;
    var sqlr = perfmon.sql_time();
    var total = sqlr.total_time;
    var running = 0;
    var output = [];
    
    output.push(' <div class="chart" id="sqlchart"><svg> </svg></div>');
    output.push(' <div class="warn"><p><strong><sup>&dagger;</sup> NOTE:</strong> SQL query capture begins on module initialization, bootstrap timings have not been logged.</p></div>');
    output.push(' <div id="sqltable">');
    output.push('  <table>');
    output.push('   <thead>');
    output.push('     <tr><th>ID</th><th>Timeline</th><th>Time</th><th>Query</th></tr>');
    output.push('    </thead>');
    output.push('   <tbody>');
    
    // highlight SQL keywords
    var re_keywords = /(\b)([A-Z]+)(\b)/g;
    
    // separate comma-delimited strings to allow wrapping
    var re_commas = /(\w)(,)(\w)/g;
    
    for(var i=0, l=sqlt.length;i<l;i++){
        var row = sqlt[i];
        var maxchar = row.statement.length == 300;
        var statement = row.statement.replace(re_keywords, '$1<b>$2</b>$3');
        statement = statement.replace(re_commas, '$1$2 $3');
        if(maxchar){
            statement = statement + '&hellip;';
        }
        var slice_size = (row.time/total * 100).toFixed(2);
        var margin_size = (running/total * 100).toFixed(2);
        running += row.time;
        
        output.push('<tr><td>', row.id,'</td><td>','<div class="timeline"><div class="slice" style="margin-left:',margin_size,'%;width:',slice_size,'%"></div></div>','</td><td>',perfmon.utils.millis(row.time),'<span class="ms">MS</span></td><td><div class="statement">', statement,'</div></td></tr>');
        
    }
    
    output.push('   </tbody>');
    output.push('  </table>');
    output.push('</div>');
    
    return output.join('');
};

// *************************************************************************************************

perfmon.render = {};
perfmon.render.handle = function(){
    var output = [];
    output.push('<a id="perfmonHandle" href="javascript:perfmon.toggle(true)">');
    output.push('  <div class="logo">&#x2211;</div>');
    output.push('  <div class="time">', Math.round(perfmon.request_time() * 1000),'<span class="ms">MS</span></div>');
    output.push('</a>');
    return $(output.join(''));
};

// *************************************************************************************************

perfmon.render.toolbar = function(){
    var output = [];
    output.push('<div id="perfmonToolbar">');
    output.push(' <div class="section">');
    output.push('  <div class="title"><a href="javascript:perfmon.toggle(true)">Hide &#9656;</a></div>');
    output.push(' </div>');
    for (var i=0; i< perfmon.scopes.length;i++){
        var scope = perfmon.scopes[i];
        output.push(' <a class="section ',scope.name,'" href="javascript:perfmon.panel(\'',scope.name,'\')">');
        output.push('  <div class="title">',scope.title,'</div>');
        output.push('  <div class="information">',scope.synopsis,'</div>');
        output.push(' </a>');
    }
    output.push('</div>');
    return $(output.join(''));
    
};

// *************************************************************************************************

perfmon.render.panels = function(){
    var output = [];
    //var logo = '<img title="" alt="" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAABkBAMAAACCzIhnAAAAA3NCSVQICAjb4U/gAAAAJ1BMVEX///////////////////////////////////////////////////9Ruv0SAAAADXRSTlMAESIzRFVmd4iZqrvMR+pJ2gAAAAlwSFlzAAALEgAACxIB0t1+/AAAAB50RVh0U29mdHdhcmUAQWRvYmUgRmlyZXdvcmtzIENTNS4xqx9I6wAABBxJREFUWIW1mLtPFEEYwHfvDkQrRIkPGjRRjFAQEhKiV6DxQYTCaGcoUCPGhIJCjBoKLTSCFGqCkXgFqIXANWCUx04ncNzN/lHuzjfv166Jft3N7G++x3zfNzMXBP9Gjlx7OrOw8ObJ7c6cwJlZFFPZfpUHKj5CccQExVv3M4n2igAAmm/1E10IR5rEG17jupAOpIp8TLONSJhfTttKVSuRMN8cRDht+MH9eWlHLjiJKGr02ogmxZFkN5WfuzZkWv4eb6+sRDKFJk3iOBbA1lTf4SBs638mJULdiFpY4UTjMZ89+pwz6L2OnGBKUP2SvNIQcqphStC+FpsB5FDTgpkOI5oDzLZ9dXyCDuObZmBusOWUoJXYqG2Xwzm6nrI33YCgPQuRbDIzrVMapM7jQSsSDNMV34mhZjr0w04ERZriNTHUQ5VYcy+V83RN8UHFryQICkizrGSsYUhZi9khbMZQkyb4pMGSZhSUvPAgtDQQ2+mquoJVqCVLitIdHxEUFeMPYtOusH/8QZ/Fsgb8KJvZcPZz0sPxR3moQ47qtL6zwTlos/GmxECGQDaH4P26NMurakMyFYbWhGOSK6INROiD7gwJ0gGsbX231AKxMK1H2A8Rr/OpgtwCkbAXAktC1k3m9rQpJg0+DtuHUrWQLr81m7kaXvAFkTLkE7TIZ7RmLtaq8iUqasBoe0q3MlKdhLWTkglXuT4ikAvx/JWrb7VQggdL3MReda302CpWVGfKbMtpivL4E4uhEKBPL7GZDuYbVPE2KxbwHnYDUon7Dxu4w8LNnSQ/mWcj6RSvb9iwPQOBhG2V1q0ZCHzDuzrJuH3bDxr+mh9pwsbU3yG5tDQrvngRlr7EYZ7jXvfRIPwo043IgyzCD5Ixa2wKdn/XjtCfgPNuD7W440DImRlOqzk+wnLMikT4XmvbHSwyNBU4tddcCMLLqzGzPZA8S920I0mR6Ucq9L60fF0Ik042A1WCxjIRcYS08Lr2IyJedFvSuvAi6CcnaLdIP/QhSL6FVnkAPQjCY4KgJ/26C4HXSP2uIGizIC3SiiT315VPU50SwU76QQeClgJd6CFGmpcv+SWhrZrUW04tkMbQE/MhBRrDyfzISSxl3IFcCD2koduU8iDUeTY+arZEA6HXXtZ5SigTYQ8C/tVFnIEU6AVWXALSES8yjFW7QK8POcYu4/Jlas6H8DeafBlPvnMjpQqrIPXyOeFE2jkh3YCI8rodCa9XeZVK9ywiQyqyCED/rPT016/3oYJEG+Pj4w9nVuWHZUNTIkeCLElqX2k2X1yE2WCp7Lvv6g4kHnMSDgR9dRN2BNV8TwgbYnmfZiCoYXmfepEswkTizUE/oSPaiyQTSfb/+60sIGk/MZdo+fXljP+TiBT6TjM5lef7/yZ/AE56+pTdPueXAAAAAElFTkSuQmCC" />';
    var logo = '';
    output.push('<div id="perfmonPanels">');
    for (var i=0; i< perfmon.scopes.length;i++){
        var scope = perfmon.scopes[i];
        output.push(' <div class="section ',scope.name,'">');
        output.push('  <div class="title">',logo, '<span class="text">',scope.title,'</span><a class="close" href="javascript:perfmon.panel()">&times;</a></div>');
        output.push('  <div class="information">');
        output.push(scope.name in perfmon.panels ? perfmon.panels[scope.name]() : '[error]');
        output.push('  </div>');
        output.push(' </div>');
    }
    output.push('</div>');
    return $(output.join(''));
};

// *************************************************************************************************

perfmon.render.charts = function(){  
    
    var data = perfmon.ls.get();
    var path = document.location.pathname;
    var pdata = data[path];
    
    var cdata = {
        time_request: {values: [], max: 0, key: 'Total'},
        time_template: {values: [], max: 0, key: 'Template'},
        time_bootstrap: {values: [], max: 0, key: 'Bootstrap'},
        time_sql: {values: [], max: 0, key: 'Time'},
        queries: {values: [], max: 0, key: 'Queries', bar: true},
        hooks: {values: [], max: 0, key: 'Hooks'}
    }
    
    var charts = perfmon.charts;
    
    // get all pdata into chart (x, y) format
    for(var k in pdata){
        
        var time = Number(k);
        
        // stored as array in ints to conserve localstorage space, order obviously matters
        // request_time (0), template_time (1), query_time (2), query_count (3), hook_count (4)
        
        var rt = pdata[k][0];
        cdata.time_request.values.push([time, rt]);
        cdata.time_request.max = Math.max(cdata.time_request.max, rt);
        
        var tt = pdata[k][1];
        cdata.time_template.values.push([time, tt]);
        cdata.time_template.max = Math.max(cdata.time_template.max, tt);
        
        var bt = (rt - tt);
        cdata.time_bootstrap.values.push([time, bt]);
        cdata.time_bootstrap.max = Math.max(cdata.time_bootstrap.max, bt);
        
        var qt = pdata[k][2];
        cdata.time_sql.values.push([time, qt]);
        cdata.time_sql.max = Math.max(cdata.time_sql.max, qt);
        
        var qc = pdata[k][3];
        cdata.queries.values.push([time, qc]);
        cdata.queries.max = Math.max(cdata.queries.max, qc);
        
        var hc = pdata[k][4];
        cdata.hooks.values.push([time, hc]);
        cdata.hooks.max = Math.max(cdata.hooks.max, hc);
        
    }
    
    var config = {};
    
    config.margin_dual = {top: 30, right: 40, bottom: 40, left: 40};
    config.margin_single = {top: 30, right: 40, bottom: 40, left: 55};
    
    // kludge, but auto width can't be found
    config.width = perfmon.utils.chart.width();
    config.height = 150;
    
    // nvd3 unknown requirement
    config.x = function(d,i) { return i };
    
    // format time on vertical axis
    config.ftime = function(d) {
       return  d3.format(',.0f')(d) + 'ms';
    };
    
    // ---------------------------------------------------------------------------
    
    charts.sql = {
        data: [cdata.queries, cdata.time_sql].map(perfmon.utils.chart.map),
        object: null
    }
    
    nv.addGraph(function() {
        
        charts.sql.object = nv.models.linePlusBarChart()
            .margin(config.margin_dual)
            .focusEnable(false)
            .x(config.x)
            .height(config.height)
            .width(config.width)
            .color(['#eee', '#0072C6']);
    
        charts.sql.object.xAxis.tickFormat(function(d) {
            var reference = charts.sql.data;
            var dx = reference[0].values[d] && reference[0].values[d].x || 0;
            return dx ? d3.time.format('%x')(new Date(dx)) : '';
        }).showMaxMin(true);
        
        charts.sql.object.y1Axis.tickFormat(d3.format(',f'));
        charts.sql.object.y2Axis.tickFormat(config.ftime);
        charts.sql.object.bars.forceY([0, perfmon.utils.chart.modbound(charts.sql.data[0].max, 50)]);
        charts.sql.object.lines.forceY([0, perfmon.utils.chart.modbound(charts.sql.data[1].max, 50)]);
        d3.select('#sqlchart svg').datum(charts.sql.data).transition().duration(500).call(charts.sql.object);
        
        perfmon.utils.chart.resize(charts.sql.object);
        
        return charts.sql.object;
    });
    
    // ---------------------------------------------------------------------------
    
    charts.hooks = {
        data: [cdata.hooks].map(perfmon.utils.chart.map),
        object: null
    }
    
    nv.addGraph(function() {
        
        charts.hooks.object = nv.models.lineChart()
            .margin(config.margin_single)
            .x(config.x)
            .height(config.height)
            .width(config.width)
            .color(['#72C600']);
    
        charts.hooks.object.xAxis.tickFormat(function(d) {
            var reference = charts.hooks.data;
            var dx = reference[0].values[d] && reference[0].values[d].x || 0;
            return dx ? d3.time.format('%x')(new Date(dx)) : '';
        }).showMaxMin(true);
        
        charts.hooks.object.forceY([0]);
        charts.hooks.object.lines.forceY([0, perfmon.utils.chart.modbound(charts.hooks.data[0].max, 50)]);
        
        d3.select('#hookschart svg').datum(charts.hooks.data).transition().duration(500).call(charts.hooks.object);
        perfmon.utils.chart.resize(charts.hooks.object);
        
        return charts.hooks.object;
    });
    
    // ---------------------------------------------------------------------------
    
    charts.time = {
        data: [cdata.time_request, cdata.time_template, cdata.time_bootstrap].map(perfmon.utils.chart.map),
        object: null
    }
    
    nv.addGraph(function() {
        
        charts.time.object = nv.models.lineChart()
            .margin(config.margin_single)
            .x(config.x)
            .height(config.height)
            .width(config.width)
            .color(['#0072C6', '#C4B700', '#72C600']);
    
        charts.time.object.xAxis.tickFormat(function(d) {
            var reference = charts.time.data;
            var dx = reference[0].values[d] && reference[0].values[d].x || 0;
            return dx ? d3.time.format('%x')(new Date(dx)) : '';
        }).showMaxMin(true);
        
        charts.time.object.yAxis.tickFormat(function(d) { return  d3.format('.0f')(d) + 'ms' });
        charts.time.object.forceY([0]);
        charts.time.object.lines.forceY([0, perfmon.utils.chart.modbound(charts.time.data[0].max, 100)]);
        
        d3.select('#timechart svg').datum(charts.time.data).transition().duration(500).call(charts.time.object);
        perfmon.utils.chart.resize(charts.time.object);
        
        return charts.time.object;
    });
    
}

// *************************************************************************************************

perfmon.panel = function(name){
    
    var current = $('#perfmonPanels .section.'+name).is(":visible");
    $('body > *').not("script").css("display","block");
    $('#perfmonPanels').css("display","none");
    $('#perfmonPanels .section').css("display","none");
    $('.section').removeClass('active')
    
    if(name && !(current)){
        
        $('body > *').not("script").css("display","none");
        $('#perfmon').css("display","block");
        $('#perfmonPanels').css("display","block");
        $('#perfmonPanels .section.'+name).css("display","block");
        $('.section.'+name).show().addClass('active');
        
        window.scrollTo(0,0);
        
        // wait to do this until requested, it can be a heavy-duty process
        if(!perfmon.rendered){
            perfmon.render.charts();
            perfmon.rendered = true;
        }
        
    }
    
    perfmon.utils.chart.widths();
    
};

// *************************************************************************************************

perfmon.toggle = function(animate){
    
    var time = animate ? 200 : 0;
    var visible = perfmon.elements.toolbar.is(":visible");
    if(!visible){
        perfmon.ls.state(true);
        perfmon.elements.toolbar.css("display","block");
        perfmon.elements.toolbar.animate({'right':0}, time);
        perfmon.elements.handle.fadeOut(time * 1.2);
    }else{
        perfmon.ls.state(false);
        $('body > *').not("script").css("display","block");
        perfmon.elements.toolbar.animate({'right':-(perfmon.elements.toolbar.width())}, time, function(){
            $(this).css("display","none");
        });
        perfmon.elements.handle.fadeIn(time * 1.2);
        perfmon.elements.panels.fadeOut(time);
    }
};

})();
