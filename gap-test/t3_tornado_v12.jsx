(function () {
    try {
        var comp = null;
        for (var i = 1; i <= app.project.numItems; i++) {
            if (app.project.item(i).name === "GapTest_T3") { comp = app.project.item(i); break; }
        }
        if (!comp) return '{"status":"error","message":"comp not found"}';
        var fx = comp.layer("Tornado").Effects.property(1);
        var report = [];

        app.beginUndoGroup("Tornado v12");
        var set = function (label, mn, v) {
            try { fx.property(mn).setValue(v); report.push('"' + label + '":"ok"'); }
            catch (e) { report.push('"' + label + '":"FAIL: ' + String(e).replace(/"/g, "'").substring(0, 45) + '"'); }
        };

        // taller + narrower funnel (rope tornado); base planted, top leans & widens
        try {
            fx.property("tc Particular-0581").expression =
                "var angRev=14.0, hPer=1.8;" +
                "var c=(time/hPer)%2; var p=1-Math.abs(1-c);" +
                "var ang=time*angRev*2*Math.PI;" +
                "var yB=710, yT=40; var y=yB+(yT-yB)*p;" +
                "var rB=5, rT=115; var r=rB+(rT-rB)*Math.pow(1-p,0.7);" +  // wide end at screen-top
                "var wob=1+0.13*Math.sin(time*6+p*8);" +
                "var lean=Math.pow(1-p,1.5)*55*Math.sin(time*0.8);" +      // wide top leans
                "[640+r*Math.sin(ang)*wob+lean, y, r*Math.cos(ang)*wob]";
            report.push('"emitterExpr":"ok"');
        } catch (e) { report.push('"emitterExpr":"FAIL: ' + String(e).replace(/"/g,"'").substring(0,60) + '"'); }

        set("ParticlesPerSec", "tc Particular-0146", 60000);
        set("Life", "tc Particular-0002", 2.0);
        set("Size", "tc Particular-0027", 1.8);
        set("SizeRandom", "tc Particular-0074", 85);
        set("Opacity", "tc Particular-0033", 22);
        set("TurbAffectPosition", "tc Particular-0711", 60);

        // PURE LEVEL camera at funnel vertical mid-point -> no foreshortening, funnel stands tall
        for (var L = comp.numLayers; L >= 1; L--) {
            if (comp.layer(L) instanceof CameraLayer) comp.layer(L).remove();
        }
        var cam = comp.layers.addCamera("Tornado Cam", [640, 375]);
        cam.position.setValue([640, 375, -1250]);
        cam.pointOfInterest.setValue([640, 375, 0]);

        app.endUndoGroup();
        comp.saveFrameToPng(5, new File("/Users/renzhongyi/Documents/AE_plugins_proj/gap-test/t3_frame_v13.png"));
        return '{"status":"done",' + report.join(",") + '}';
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return '{"status":"error","message":"' + String(e).replace(/"/g, "'") + '"}';
    }
})();
