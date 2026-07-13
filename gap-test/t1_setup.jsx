(function () {
    var out = [];
    app.beginUndoGroup("GapTest T1 Setup");
    try {
        var comp = app.project.items.addComp("GapTest_T1", 1280, 720, 1, 6, 30);
        comp.openInViewer();
        var solid = comp.layers.addSolid([0, 0, 0], "Particular Host", 1280, 720, 1, 6);
        var fx = solid.Effects.addProperty("tc Particular");
        out.push('"status":"success"');
        out.push('"comp":"' + comp.name + '"');
        out.push('"effectName":"' + fx.name + '"');
        out.push('"effectMatchName":"' + fx.matchName + '"');
        out.push('"numTopProps":' + fx.numProperties);
        out.push('"saveFrameToPng":"' + (typeof comp.saveFrameToPng) + '"');
        out.push('"aeVersion":"' + app.version + '"');
    } catch (e) {
        out.push('"status":"error"');
        out.push('"message":"' + String(e).replace(/"/g, "'") + '"');
    }
    app.endUndoGroup();
    return "{" + out.join(",") + "}";
})();
