import * as _ from 'lodash';
import {DiffGenerator, IDifference} from "./diff_generator_service";

import {logger, TEST_DB} from "../../globals";
import {PROD_DB} from "../../globals";

export interface ITableInfo {
    tableName: string;
    primaryKeys: Array<string>;
    tableData: Array<any>;
}

export interface IComparatorSettings {
    searchByPrimaries: boolean;
    ignorePrimaries: boolean;
}

export class Comparator {

    myDifferences: Array<IDifference> = [];
    tableName: string;
    primaryKeys: Array<string>;

    diffGenerator = new DiffGenerator();
    tableTestInfo: ITableInfo;
    tableProdInfo: ITableInfo;

    uniqueColumnsInTest: Array<string>;
    uniqueColumnsInProd: Array<string>;

    public compareTables(tableTestInfo: ITableInfo, tableProdInfo: ITableInfo, comparatorSettings: IComparatorSettings): Array<IDifference> {

        this.tableTestInfo = tableTestInfo;
        this.tableProdInfo = tableProdInfo;

        this.tableName = tableTestInfo.tableName;
        this.primaryKeys = tableTestInfo.primaryKeys;

        this.diffGenerator.tableName = this.tableName;

        this.myDifferences.length = 0;
        let findRow;
        let compareRows;
        [findRow, compareRows] = this.configureComparator(comparatorSettings);

        this.checkTablesColumns(tableTestInfo.tableData[0], tableProdInfo.tableData[0]);

        tableTestInfo.tableData.forEach(rowTest => {
            const rowProd = findRow(rowTest, tableProdInfo);

            if (!rowProd) {
                this.myDifferences.push(this.diffGenerator.generateNoSuchRowDiff(rowTest, PROD_DB, this.primaryKeys));
            } else {
                tableProdInfo.tableData.splice(tableProdInfo.tableData.indexOf(rowProd), 1);
                compareRows(rowTest, rowProd);
            }
        });

        //make differences from rest of lines in table2
        for (let row of tableProdInfo.tableData) {
            this.myDifferences.push(this.diffGenerator.generateNoSuchRowDiff(row, TEST_DB, this.primaryKeys));
        }

        return this.myDifferences;
    };

    configureComparator(comparatorSettings: IComparatorSettings): [any, any] {
        // edit data according to settings: search by primary / search by same values/ ignore primary

        let findRow;
        let compareRows;
        if (comparatorSettings.searchByPrimaries && this.tableTestInfo.primaryKeys.length != 0
            && this.tableProdInfo.primaryKeys.length != 0 && !comparatorSettings.ignorePrimaries) {

            findRow = this.findWithSamePrimaries.bind(this);
            compareRows = this.compareRows.bind(this);
        } else {
            if (comparatorSettings.ignorePrimaries) {
                this.deletePrimaryColumnsFromTables();
            }
            findRow = this.findWithSameValues.bind(this);
            compareRows = ((rowTest: Array<any>, rowProd: Array<any>, myDifferences: IDifference[]) => {
                return
            });
        }
        return [findRow, compareRows];
    }

    findWithSamePrimaries(rowTest: Array<any>): Array<any> {
        let keyColumnsOfRowTest = new Map<string, string>();

        Object.keys(rowTest).forEach(key => {
            if (this.isPrimaryColumn(key)) keyColumnsOfRowTest.set(key, rowTest[key]);
        });

        for (let rowProd of this.tableProdInfo.tableData) {

            let keyColumnsOfRowProd = new Map<string, string>();

            Object.keys(rowProd).forEach(key => {
                if (this.isPrimaryColumn(key)) keyColumnsOfRowProd.set(key, rowProd[key]);
            });

            if (this.samePrimaryKeysValues(keyColumnsOfRowTest, keyColumnsOfRowProd)) {
                return rowProd;
            }
        }
        return null;
    }

    findWithSameValues(rowTest: Array<any>): Array<any> {

        for (let row2 of this.tableProdInfo.tableData) {

            let valuesEquals: boolean = true;
            Object.keys(rowTest).forEach((key: string) => {

                if (row2[key] != rowTest[key]) {
                    valuesEquals = false;
                }
            });

            if (valuesEquals) return row2;
        }
        return null;
    }

    compareRows(rowTest: Array<any>, rowProd: Array<any>) {
        // check columns for equal values, make differences is not
        for (let key of Object.keys(rowTest)) {
            const value = rowTest[key];

            if (this.uniqueColumnsInTest.indexOf(key) == -1 && rowProd[key] != value) {
                this.myDifferences = this.myDifferences.concat(this.diffGenerator.generateDifferentValuesDiff(rowTest, rowProd, this.primaryKeys));
                break;
            }
        }
    }

    checkTablesColumns(rowTest: any, rowProd: any) {
        const row1Columns: Array<string> = Object.keys(rowTest);
        const row2Columns: Array<string> = Object.keys(rowProd);

        this.uniqueColumnsInTest = row1Columns.filter(val => row2Columns.indexOf(val) == -1);
        this.uniqueColumnsInProd = row2Columns.filter(val => row1Columns.indexOf(val) == -1);

        if (this.uniqueColumnsInTest.length > 0 || this.uniqueColumnsInProd.length > 0) {
            this.myDifferences = this.myDifferences.concat(this.diffGenerator.generateNoSuchColumns(this.uniqueColumnsInTest, this.uniqueColumnsInProd));
        }
    }

    deletePrimaryColumnsFromTables() {
        this.tableTestInfo.tableData.forEach(row => {
            this.primaryKeys.forEach(key => {
                delete row[key];
            });
            row = _.pickBy(row, v => v !== undefined);
        });
        this.tableProdInfo.tableData.forEach(row => {
            this.primaryKeys.forEach(key => {
                delete row[key];
            });
            row = _.pickBy(row, v => v !== undefined);
        });
    }

    samePrimaryKeysValues(primaryKeysValues1: Map<string, string>, primaryKeysValues2: Map<string, string>): boolean {
        return _.isEqual(primaryKeysValues1, primaryKeysValues2);
    }

    isPrimaryColumn(key: string): boolean {
        return this.primaryKeys.indexOf(_.snakeCase(key)) != -1;
    }

    compareListOfTablesNamesAndMakeDiffs(testTables: Array<string>, prodTables: Array<string>): { tablesToCompare:Array<string>, tableDifferences: Array<IDifference>} {
        let differences: Array<IDifference> = [];
        let schema: string;

        //making testTables equals prodTables and making diffs
        let tableListDiffs: Array<string> = _.differenceWith(testTables, prodTables, _.isEqual);
        tableListDiffs = tableListDiffs.concat(_.differenceWith(prodTables, testTables, _.isEqual));
        tableListDiffs.forEach(tableName => {

            if (testTables.indexOf(tableName) != -1) {
                schema = PROD_DB;
                testTables.splice(testTables.indexOf(tableName), 1);
            } else {
                schema = TEST_DB;
                prodTables.splice(prodTables.indexOf(tableName), 1);
            }

            differences = differences.concat(this.diffGenerator.generateNoSuchTable(tableName, schema));
        });

        return {tablesToCompare: testTables, tableDifferences: differences};
    }
}