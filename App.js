Ext.define('CustomApp', {
    extend: 'Rally.app.App',
    componentCls: 'app',
    layout:'border',
    items: [
        {xtype:'container',itemId:'grid_box',region:'center',padding: 5,layout:'fit'}
    ],

    attributes_by_uuid: {},

    launch: function() {
        this.setLoading();
        this._getAttributes();
    },

    _getAttributes: function() {
        var me = this;

        Ext.create('Rally.data.wsapi.Store',{
            model:'TypeDefinition',
            filters: [{property:'TypePath',operator:'contains',value:'PortfolioItem/'}],
            fetch: ['Name','ObjectID','Attributes']
        }).load({
            scope: this,
            callback: function(records,operation){
                console.log(records,operation);
                this.setLoading('Loading data');
                var promises = Ext.Array.map(records, function(record){
                    return function() { return me._getAttributesFromTypeDefinition(record); };
                });

                Deft.Chain.sequence(promises, this).then({
                    scope: this,
                    success: function(results){
                        console.log(results);
                        var attribute_hash = {};
                        Ext.Array.each(results, function(result){
                            Ext.Array.each(result, function(attribute){
                                attribute_hash[attribute.get('_refObjectUUID')] = attribute.get('ElementName');
                            });
                        });

                        this.attributes_by_uuid = attribute_hash;
                        this._getViewPreferences();
                    }
                });
            }
        });
    },

    _getAttributesFromTypeDefinition: function(def){
        var deferred = Ext.create('Deft.Deferred');
        def.getCollection('Attributes').load({
            fetch: ['ElementName'],
            //callback: function(records, operation, success) {
            callback: function(records) {
                console.log('attributes', records);
                deferred.resolve(records);
            }
        });
        return deferred.promise;
    },

    _getViewPreferences: function() {
        console.log(this.getContext().getUser());
        var user_filters = Rally.data.wsapi.Filter.or([
            {property:'User',value:null},
            {property:'User',value:this.getContext().getUser()._ref}
        ]);

        var and_filters = Rally.data.wsapi.Filter.and([
            {property:'Type',value:'View'},
            {property:'Workspace',value:this.getContext().getWorkspaceRef()},
            {property:'AppId',value:-200005} // the portfolioitems page
        ]);

        var filters = and_filters.and(user_filters);

        var store = Ext.create('Rally.data.wsapi.Store',{
            model:'Preference',
            filters: filters,
            fetch: ['Name','ObjectID','Value','Type','User','Project','AppId']
        });

        store.load({
            scope: this,
            callback: this._getFiltersFromPrefs
        });
    },
    _getFiltersFromPrefs: function(prefs) {
        var saved_filters = [];
        Ext.Array.each ( prefs, function(record){
            var name = record.get('Name');
            var value = record.get('Value');
            if ( value !== "" ) {
                value = JSON.parse(value);
                var advanced_filters = value.advancedFilters || [];
                Ext.Array.each(advanced_filters, function(filter){
                    saved_filters.push({
                        view_name: name,
                        property: filter.name,
                        operator: filter.operator || "=",
                        value: filter.rawValue,
                        type: 'Advanced'
                    });
                });
                var quick_filters = value.quickFilters || [];
                Ext.Array.each(quick_filters, function(filter){
                    saved_filters.push({
                        view_name: name,
                        property: filter.name,
                        operator: filter.operator || "=",
                        value: filter.rawValue,
                        type: 'Quick'
                    });
                });
            }
            console.log(value);
        });
        this._populateReferenceValues(saved_filters).then({
            scope: this,
            success: function(populated_values) {
                this._makeGrid(populated_values);
            }
        });
    },

    _populateReferenceValues:function(saved_filters){
        var deferred = Ext.create('Deft.Deferred');
        var values = Ext.Array.unique(
            Ext.Array.map(saved_filters, function(filter){
                return filter.value;
            })
        );
        var promises = [];
        Ext.Array.each(values, function(value){
            if ( Ext.isEmpty(value) || !Ext.isString(value) ) {
                return;
            }
            var splitted = value.split('/');
            if ( splitted.length !== 3 ) { return; }
            var type = splitted[1];
            var uuid = splitted[2];
            console.log(type,uuid);
            promises.push(
                function() {
                    return this._getItem(value,type,uuid,saved_filters);
                }
            );
        },this);
        Deft.Chain.sequence(promises,this).then({
            success: function(result) {
                console.log('result', result);
                deferred.resolve(saved_filters);
            }
        });
        return deferred.promise;
    },

    _getItem: function(value,type,uuid,saved_filters) {
        var deferred = Ext.create('Deft.Deferred');
        Rally.data.ModelFactory.getModel({
            type: type,
            success: function(model) {
                //Use the model here
                model.load(uuid, {
                    fetch: ['ObjectID'],
                    callback: function(result, operation) {
                        if(operation.wasSuccessful()) {
                            var name = result.get('_refObjectName');
                            if ( name ) {
                                Ext.Array.each(saved_filters, function(filter){
                                    if ( filter.value == value ) {
                                        filter.value = name;
                                    }
                                });
                            }
                        }
                        deferred.resolve();
                    }
                });
            },
            failure: function(msg) {
                console.log(msg);
                deferred.resolve();
            }
        });
        return deferred.promise;
    },

    _makeGrid: function(records){
        Ext.Array.each(records, function(record){
            if ( record.property && this.attributes_by_uuid[record.property] ) {
                record.property = this.attributes_by_uuid[record.property];
            }
        },this);

        var store = Ext.create('Rally.data.custom.Store',{
            data: records
        });

        this.down('#grid_box').add({
            xtype:'rallygrid',
            store: store,
            showRowActionsColumn: false,
            columnCfgs: this._getColumns(),
            pagingToolbarCfg: {
                pageSizes: [25, 50, 100, 200, 500, 1000]
            }
        });
        this.setLoading(false);
    },

    _getColumns: function() {
        return [
            {text: 'View', dataIndex: 'view_name'},
            {text: 'Filter Type', dataIndex: 'type'},
            {text: 'Property', dataIndex: 'property',flex:1},
            {text: 'Operator', dataIndex: 'operator',flex:1},
            {text: 'Value', dataIndex: 'value',flex:1}
        ];
    }
});
