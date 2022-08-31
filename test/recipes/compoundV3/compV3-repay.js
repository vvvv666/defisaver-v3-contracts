const { expect } = require('chai');
const hre = require('hardhat');
const ethers = require('ethers');
const { getAssetInfo } = require('@defisaver/tokens');
const dfs = require('@defisaver/sdk');
const { supplyCompV3, borrowCompV3, executeAction } = require('../../actions');

const {
    getProxy,
    redeploy,
    formatExchangeObj,
    setNewExchangeWrapper,
    fetchAmountinUSDPrice,
    UNISWAP_WRAPPER,
    nullAddress,
    approve,
    getAddrFromRegistry,
} = require('../../utils');

const cometABI = [
    'function collateralBalanceOf(address account, address asset) external view returns (uint128)',
    'function borrowBalanceOf(address account) public view returns (uint256)',
];
const cometAddress = '0xc3d688B66703497DAA19211EEdff47f25384cdc3';

describe('CompoundV3 Repay recipe test', function () {
    this.timeout(80000);

    let uniWrapper;
    let senderAcc;
    let proxy;
    let aaveV2FlAddr;

    before(async () => {
        uniWrapper = await redeploy('UniswapWrapperV3');
        await redeploy('CompV3Supply');
        await redeploy('CompV3Withdraw');
        await redeploy('DFSSell');
        await redeploy('CompV3Payback');
        await redeploy('CompV3Borrow');

        aaveV2FlAddr = await getAddrFromRegistry('FLAaveV2');

        senderAcc = (await hre.ethers.getSigners())[0];
        proxy = await getProxy(senderAcc.address);

        await setNewExchangeWrapper(senderAcc, uniWrapper.address);
    });

    ['WETH', 'WBTC'].forEach((ilk) => {
        const tokenData = getAssetInfo(ilk);
        let repayAmount = fetchAmountinUSDPrice(tokenData.symbol, '100');

        it(`... should call a repay ${repayAmount} ${ilk}`, async () => {
            const comet = new ethers.Contract(cometAddress, cometABI, senderAcc);
            const assetInfo = getAssetInfo('USDC');

            const colAmount = hre.ethers.utils.parseUnits(
                fetchAmountinUSDPrice(tokenData.symbol, '10000'),
                tokenData.decimals,
            );

            // Supply action
            await supplyCompV3(
                proxy,
                tokenData.address,
                colAmount,
                senderAcc.address,
            );

            const borrowingAmount = hre.ethers.utils.parseUnits(
                fetchAmountinUSDPrice('USDC', '2000'),
                assetInfo.decimals,
            );

            await borrowCompV3(proxy, borrowingAmount, senderAcc.address);
            repayAmount = hre.ethers.utils.parseUnits(repayAmount, tokenData.decimals);

            // Get ratio before
            const colBefore = await comet.collateralBalanceOf(proxy.address, tokenData.address);
            const debtBefore = await comet.borrowBalanceOf(proxy.address);
            const ratioBefore = colBefore / debtBefore;

            const from = proxy.address;
            const to = proxy.address;
            const collToken = tokenData.address;
            const fromToken = getAssetInfo('USDC').address;

            // Withdraw col

            const compV3WithdrawAction = new dfs.actions.compoundV3.CompoundV3WithdrawAction(
                to,
                tokenData.address,
                repayAmount,
            );

            // Sell col

            const sellAction = new dfs.actions.basic.SellAction(
                formatExchangeObj(collToken, fromToken, '$1', UNISWAP_WRAPPER),
                from,
                to,
            );

            // Payback

            await approve(fromToken, proxy.address);

            const paybackCompV3Action = new dfs.actions.compoundV3.CompoundV3PaybackAction(
                '$2',
                senderAcc.address,
                proxy.address,
            );

            const repayRecipe = new dfs.Recipe('RepayRecipe', [
                compV3WithdrawAction,
                sellAction,
                paybackCompV3Action,
            ]);

            const functionData = repayRecipe.encodeForDsProxyCall();

            await executeAction('RecipeExecutor', functionData[1], proxy);

            // Get ratio after
            const colAfter = await comet.collateralBalanceOf(proxy.address, tokenData.address);
            const debtAfter = await comet.borrowBalanceOf(proxy.address);
            const ratioAfter = colAfter / debtAfter;

            expect(colBefore).to.be.gt(colAfter);
            expect(debtBefore).to.be.gt(debtAfter);
            expect(ratioAfter).to.be.gt(ratioBefore);
        });

        it(`... should call a FL repay ${repayAmount} ${tokenData.symbol}`, async () => {
            const comet = new ethers.Contract(cometAddress, cometABI, senderAcc);
            const assetInfo = getAssetInfo('USDC');
            const colAmount = hre.ethers.utils.parseUnits(
                fetchAmountinUSDPrice(tokenData.symbol, '5000'),
                tokenData.decimals,
            );

            // Supply action
            await supplyCompV3(
                proxy,
                tokenData.address,
                colAmount,
                senderAcc.address,
            );

            const borrowingAmount = hre.ethers.utils.parseUnits(
                fetchAmountinUSDPrice('USDC', '2000'),
                assetInfo.decimals,
            );

            await borrowCompV3(proxy, borrowingAmount, senderAcc.address);
            const flAmount = hre.ethers.utils.parseUnits('0.2', tokenData.decimals);

            // Get ratio before
            const colBefore = await comet.collateralBalanceOf(proxy.address, tokenData.address);
            const debtBefore = await comet.borrowBalanceOf(proxy.address);
            const ratioBefore = colBefore / debtBefore;

            const collToken = tokenData.address;
            const fromToken = getAssetInfo('USDC').address;

            const exchangeOrder = formatExchangeObj(
                collToken,
                fromToken,
                flAmount,
                UNISWAP_WRAPPER,
            );

            const flAaveV2Action = new dfs.actions.flashloan.AaveV2FlashLoanAction(
                [flAmount],
                [collToken],
                [0],
                nullAddress,
                nullAddress,
                [],
            );

            const repayRecipe = new dfs.Recipe('FLRepayRecipe', [
                flAaveV2Action,
                new dfs.actions.basic.SellAction(exchangeOrder, proxy.address, proxy.address),
                new dfs.actions.compoundV3.CompoundV3PaybackAction(
                    '$2',
                    senderAcc.address,
                    proxy.address,
                ),
                new dfs.actions.compoundV3.CompoundV3WithdrawAction(
                    aaveV2FlAddr,
                    tokenData.address,
                    '$1',
                ),
            ]);

            const functionData = repayRecipe.encodeForDsProxyCall();

            await executeAction('RecipeExecutor', functionData[1], proxy);

            // Get ratio after
            const colAfter = await comet.collateralBalanceOf(proxy.address, tokenData.address);
            const debtAfter = await comet.borrowBalanceOf(proxy.address);
            const ratioAfter = colAfter / debtAfter;

            expect(colBefore).to.be.gt(colAfter);
            expect(debtBefore).to.be.gt(debtAfter);
            expect(ratioAfter).to.be.gt(ratioBefore);
        });
    });
});