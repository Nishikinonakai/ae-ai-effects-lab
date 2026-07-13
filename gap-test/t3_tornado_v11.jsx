(function () {
    try {
        var comp = null;
        for (var i = 1; i <= app.project.numItems; i++) {
            if (app.project.item(i).name === "GapTest_T3") { comp = app.project.item(i); break; }
        }
        if (!comp) return '{"status":"error","message":"comp not found"}';
        var fx = comp.layer("Tornado").Effects.property(1);
        var report = [];

        app.beginUndoGroup("Tornado v11 hero");
        var set = function (label, mn, v) {
            try { fx.property(mn).setValue(v); report.push('"' + label + '":"ok"'); }
            catch (e) { report.push('"' + label + '":"FAIL: ' + String(e).replace(/"/g, "'").substring(0, 45) + '"'); }
        };

        // v9 dense funnel + gentle organic wander (no top-down overshoot)
        try {
            fx.property("tc Particular-0581").expression =
                "var angRev=13.0, hPer=1.9;" +
                "var c=(time/hPer)%2; var p=1-Math.abs(1-c);" +
                "var ang=time*angRev*2*Math.PI;" +
                "var yB=700, yT=70; var y=yB+(yT-yB)*p;" +
                "var rB=6, rT=150; var r=rB+(rT-rB)*Math.pow(p,0.78);" +
                "var wob=1+0.14*Math.sin(time*6+p*8);" +
                "var lean=p*p*35*Math.sin(time*0.9);" +   // top leans, base planted
                "[640+r*Math.sin(ang)*wob+lean, y, r*Math.cos(ang)*wob]";
            report.push('"emitterExpr":"ok"');
        } catch (e) { report.push('"emitterExpr":"FAIL: ' + String(e).replace(/"/g,"'").substring(0,60) + '"'); }

        set("ParticlesPerSec", "tc Particular-0146", 55000);
        set("Life", "tc Particular-0002", 2.0);
        set("Size", "tc Particular-0027", 1.9);
        set("SizeRandom", "tc Particular-0074", 85);
        set("Opacity", "tc Particular-0033", 24);
        set("TurbAffectPosition", "tc Particular-0711", 55);
        set("Color", "tc Particular-0070", [0.66, 0.6, 0.54, 1]);

        // near-level front view (v9), slight look-up for menace
        for (var L = comp.numLayers; L >= 1; L--) {
            if (comp.layer(L) instanceof CameraLayer) comp.layer(L).remove();
        }
        var cam = comp.layers.addCamera("Tornado Cam", [640, 400]);
        cam.position.setValue([640, 430, -1180]);
        cam.pointOfInterest.setValue([640, 380, 0]);

        app.endUndoGroup();
        comp.saveFrameToPng(5, new File("/Users/renzhongyi/Documents/AE_plugins_proj/gap-test/t3_frame_v11.png"));
        return '{"status":"done",' + report.join(",") + '}';
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return '{"status":"error","message":"' + String(e).replace(/"/g, "'") + '"}';
    }
})();
