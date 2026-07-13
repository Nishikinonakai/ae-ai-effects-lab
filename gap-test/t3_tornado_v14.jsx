(function () {
    try {
        var comp = null;
        for (var i = 1; i <= app.project.numItems; i++) {
            if (app.project.item(i).name === "GapTest_T3") { comp = app.project.item(i); break; }
        }
        if (!comp) return '{"status":"error","message":"comp not found"}';
        var fx = comp.layer("Tornado").Effects.property(1);
        var report = [];

        app.beginUndoGroup("Tornado v14");
        var set = function (label, mn, v) {
            try { fx.property(mn).setValue(v); report.push('"' + label + '":"ok"'); }
            catch (e) { report.push('"' + label + '":"FAIL: ' + String(e).replace(/"/g, "'").substring(0, 45) + '"'); }
        };

        // wide storm-cloud top (large y), tapering to narrow touchdown (small y); heavy chaos = real column
        try {
            fx.property("tc Particular-0581").expression =
                "var angRev=15.0, hPer=1.7;" +
                "var c=(time/hPer)%2; var p=1-Math.abs(1-c);" +   // p=0 base, p=1 top
                "var ang=time*angRev*2*Math.PI;" +
                "var yBase=680, yTop=90; var y=yBase+(yTop-yBase)*p;" +
                "var rBase=8, rTop=170; var r=rBase+(rTop-rBase)*Math.pow(p,1.3);" + // convex flare near top
                "var wob=1+0.15*Math.sin(time*6+p*8);" +
                "var lean=Math.pow(p,1.6)*70*Math.sin(time*0.7);" +
                "[640+r*Math.sin(ang)*wob+lean, y, r*Math.cos(ang)*wob]";
            report.push('"emitterExpr":"ok"');
        } catch (e) { report.push('"emitterExpr":"FAIL: ' + String(e).replace(/"/g,"'").substring(0,60) + '"'); }

        set("ParticlesPerSec", "tc Particular-0146", 60000);
        set("Life", "tc Particular-0002", 2.1);
        set("Size", "tc Particular-0027", 1.7);
        set("SizeRandom", "tc Particular-0074", 90);
        set("Opacity", "tc Particular-0033", 20);
        set("TurbAffectPosition", "tc Particular-0711", 95);   // violent churn -> column, not tidy rings

        // Camera BELOW base, looking UP -> wide top towers, narrow base near viewer
        for (var L = comp.numLayers; L >= 1; L--) {
            if (comp.layer(L) instanceof CameraLayer) comp.layer(L).remove();
        }
        var cam = comp.layers.addCamera("Tornado Cam", [640, 360]);
        cam.position.setValue([640, 690, -820]);
        cam.pointOfInterest.setValue([640, 210, 0]);

        app.endUndoGroup();
        comp.saveFrameToPng(5, new File("/Users/renzhongyi/Documents/AE_plugins_proj/gap-test/t3_frame_v14.png"));
        return '{"status":"done",' + report.join(",") + '}';
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return '{"status":"error","message":"' + String(e).replace(/"/g, "'") + '"}';
    }
})();
