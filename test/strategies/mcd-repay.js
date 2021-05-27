const hre = require('hardhat');
const { expect } = require('chai');

const dfs = require('@defisaver/sdk');

const { getAssetInfo, ilks } = require('@defisaver/tokens');

const {
    createMcdTrigger,
    RATIO_STATE_UNDER,
} = require('../triggers');

const {
    getProxy,
    redeploy,
    formatExchangeObj,
    UNISWAP_WRAPPER,
    WETH_ADDRESS,
    DAI_ADDR,
} = require('../utils');

const {
    subTemplate,
    getLatestTemplateId,
    subStrategy,
    addBotCaller,
} = require('../utils-strategies.js');

const {
    getRatio,
} = require('../utils-mcd.js');

const { openVault } = require('../actions');

const { fetchMakerAddresses, MCD_MANAGER_ADDR } = require('../utils-mcd');

describe('Mcd-Repay', function () {
    this.timeout(80000);

    let senderAcc; let proxy; let makerAddresses;
    let botAcc; let strategyExecutor; let strategyId; let vaultId;
    let mcdView;

    const ethJoin = ilks[0].join;

    before(async () => {
        await redeploy('ProxyAuth');
        await redeploy('McdRatioTrigger');
        await redeploy('McdWithdraw');
        await redeploy('DFSSell');
        await redeploy('McdPayback');
        await redeploy('Subscriptions');
        await redeploy('SubscriptionProxy');
        await redeploy('TaskExecutor');
        strategyExecutor = await redeploy('StrategyExecutor');
        await redeploy('BotAuth');
        mcdView = await redeploy('McdView');

        senderAcc = (await hre.ethers.getSigners())[0];
        botAcc = (await hre.ethers.getSigners())[1];

        await addBotCaller(botAcc.address);

        proxy = await getProxy(senderAcc.address);
        makerAddresses = await fetchMakerAddresses();
    });

    it('... should make a new Mcd repay strategy', async () => {
        const name = 'McdRepayTemplate';
        const triggerIds = ['McdRatioTrigger'];
        const actionIds = ['McdWithdraw', 'DFSSell', 'McdPayback'];
        const paramMapping = [[0, 0, 0, 0], [0, 0, 1, 0, 0], [0, 2, 0]];

        const tokenData = getAssetInfo('WETH');

        await subTemplate(proxy, name, triggerIds, actionIds, paramMapping);

        vaultId = await openVault(
            makerAddresses,
            proxy,
            ethJoin,
            tokenData,
            '6',
            '8000',
        );

        const rationUnder = hre.ethers.utils.parseUnits('2.5', '18');

        const templateId = await getLatestTemplateId();
        const triggerData = await createMcdTrigger(vaultId, rationUnder, RATIO_STATE_UNDER);

        strategyId = await subStrategy(proxy, templateId, true, [[], [], []], [triggerData]);
    });

    it('... should trigger and execute a Mcd Repay strategy', async () => {
        const abiCoder = new hre.ethers.utils.AbiCoder();

        const triggerCallData = [];
        const actionsCallData = [];

        const repayAmount = hre.ethers.utils.parseUnits('0.5', '18');

        const withdrawAction = new dfs.actions.maker.MakerWithdrawAction(
            vaultId,
            repayAmount,
            ethJoin,
            proxy.address,
            MCD_MANAGER_ADDR,
        );

        const sellAction = new dfs.actions.basic.SellAction(
            formatExchangeObj(
                WETH_ADDRESS,
                DAI_ADDR,
                '$1',
                UNISWAP_WRAPPER,
            ),
            proxy.address,
            proxy.address,
        );

        const mcdPaybackAction = new dfs.actions.maker.MakerPaybackAction(
            vaultId,
            '$2',
            proxy.address,
            MCD_MANAGER_ADDR,
        );

        actionsCallData.push(withdrawAction.encodeForRecipe()[0]);
        actionsCallData.push(sellAction.encodeForRecipe()[0]);
        actionsCallData.push(mcdPaybackAction.encodeForRecipe()[0]);

        triggerCallData.push([abiCoder.encode(['uint256'], ['0'])]);

        const ratioBefore = await getRatio(mcdView, vaultId);

        const strategyExecutorByBot = strategyExecutor.connect(botAcc);
        await strategyExecutorByBot.executeStrategy(strategyId, triggerCallData, actionsCallData, {
            gasLimit: 5000000,
        });

        const ratioAfter = await getRatio(mcdView, vaultId);

        expect(ratioAfter).to.be.gt(ratioBefore);
    });
});
