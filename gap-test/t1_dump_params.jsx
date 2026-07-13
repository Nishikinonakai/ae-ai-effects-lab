(function () {
    try {
        var comp = null;
        for (var i = 1; i <= app.project.numItems; i++) {
            if (app.project.item(i).name === "GapTest_T1") { comp = app.project.item(i); break; }
        }
        if (!comp) return '{"status":"error","message":"comp not found"}';
        var fx = comp.layer(1).Effects.property(1);

        var f = new File("/Users/renzhongyi/Documents/AE_plugins_proj/gap-test/particular_params.tsv");
        f.encoding = "UTF-8";
        f.open("w");
        f.writeln("idx\tname\tmatchName\ttype\tvalue");
        var counts = { total: 0, withValue: 0 };
        for (var p = 1; p <= fx.numProperties; p++) {
            var prop = fx.property(p);
            counts.total++;
            var val = "";
            var ptype = "";
            try {
                if (prop.propertyType === PropertyType.PROPERTY) {
                    ptype = prop.propertyValueType.toString();
                    if (prop.propertyValueType !== PropertyValueType.NO_VALUE &&
                        prop.propertyValueType !== PropertyValueType.CUSTOM_VALUE) {
                        val = String(prop.value);
                        counts.withValue++;
                    }
                } else {
                    ptype = "GROUP";
                }
            } catch (e) { ptype = "ERR:" + String(e).substring(0, 40); }
            f.writeln(p + "\t" + prop.name + "\t" + prop.matchName + "\t" + ptype + "\t" + val);
        }
        f.close();
        return '{"status":"success","total":' + counts.total + ',"withValue":' + counts.withValue + '}';
    } catch (e) {
        return '{"status":"error","message":"' + String(e).replace(/"/g, "'") + '"}';
    }
})();
