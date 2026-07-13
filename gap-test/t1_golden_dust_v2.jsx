(function () {
    try {
        var comp = null;
        for (var i = 1; i <= app.project.numItems; i++) {
            if (app.project.item(i).name === "GapTest_T1") { comp = app.project.item(i); break; }
        }
        if (!comp) return '{"status":"error","message":"comp not found"}';

        app.beginUndoGroup("Golden Dust v2");

        // black background under the particle layer (Particular outputs on transparency)
        var hasBG = false;
        for (var L = 1; L <= comp.numLayers; L++) {
            if (comp.layer(L).name === "BG") { hasBG = true; break; }
        }
        if (!hasBG) {
            var bg = comp.layers.addSolid([0.02, 0.015, 0.01], "BG", 1280, 720, 1, 6);
            bg.moveToEnd();
        }

        var fx = comp.layer("Particular Host").Effects.property(1);
        var set = function (mn, v) { fx.property(mn).setValue(v); };

        // concentrate emitter at the bottom, wide and shallow
        set("tc Particular-0577", 2);              // Emitter Size: XYZ Individual
        set("tc Particular-0014", 1300);           // X wide
        set("tc Particular-0015", 120);            // Y shallow
        set("tc Particular-0016", 400);            // Z depth
        set("tc Particular-0581", [640, 640, 0]);  // near bottom

        // richness
        set("tc Particular-0074", 70);             // Size Random %
        set("tc Particular-0075", 60);             // Opacity Random
        set("tc Particular-0027", 2.0);            // Size slightly smaller
        set("tc Particular-0216", 60);             // Glow Opacity
        set("tc Particular-0215", 200);            // Glow Size

        // organic motion
        set("tc Particular-0711", 40);             // Air Turbulence: Affect Position

        app.endUndoGroup();

        var f = new File("/Users/renzhongyi/Documents/AE_plugins_proj/gap-test/t1_frame_v2.png");
        comp.saveFrameToPng(4, f);
        return '{"status":"success"}';
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return '{"status":"error","message":"' + String(e).replace(/"/g, "'") + '"}';
    }
})();
