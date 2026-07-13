(function () {
    try {
        var comp = null;
        for (var i = 1; i <= app.project.numItems; i++) {
            if (app.project.item(i).name === "GapTest_T3") { comp = app.project.item(i); break; }
        }
        if (!comp) return '{"status":"error","message":"comp not found"}';

        app.beginUndoGroup("Tornado v8 - 3D camera");

        // remove any prior test camera
        for (var L = comp.numLayers; L >= 1; L--) {
            if (comp.layer(L) instanceof CameraLayer) comp.layer(L).remove();
        }

        // Two-node camera: look slightly DOWN into the funnel from front -> rings read as ellipses,
        // taper reads as an upright cone. POI at mid-funnel, cam above & in front.
        var cam = comp.layers.addCamera("Tornado Cam", [640, 430]);  // centerPoint is 2D
        cam.position.setValue([640, 250, -1050]);                     // above center, pulled back
        cam.pointOfInterest.setValue([640, 430, 0]);                  // look at mid-funnel

        app.endUndoGroup();
        comp.saveFrameToPng(5, new File("/Users/renzhongyi/Documents/AE_plugins_proj/gap-test/t3_frame_v8.png"));
        return '{"status":"done","camera":"' + cam.name + '","pos":"' + cam.position.value.toString() + '"}';
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return '{"status":"error","message":"' + String(e).replace(/"/g, "'") + '"}';
    }
})();
