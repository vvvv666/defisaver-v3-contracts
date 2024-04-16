const hre = require('hardhat');
const dfs = require('@defisaver/sdk');
const { expect } = require('chai');
const { getAssetInfo } = require('@defisaver/tokens');
const {
    getProxy, redeploy,
    setBalance, approve, nullAddress, fetchAmountinUSDPrice,
    addrs,
    setNewExchangeWrapper,
    formatMockExchangeObj,
    chainIds,
} = require('../../utils');
const { executeAction } = require('../../actions');

describe('Aave-EOA-Repay', function () {
    const network = hre.network.config.name;
    this.timeout(150000);
    let senderAcc; let proxy; let pool; let wethAddr; let daiAddr;

    before(async () => {
        console.log('NETWORK:', network);
        senderAcc = (await hre.ethers.getSigners())[0];
        proxy = await getProxy(senderAcc.address);
        const mockWrapper = await redeploy('MockExchangeWrapper');
        await setNewExchangeWrapper(senderAcc, mockWrapper.address);
        await redeploy('PermitToken');

        wethAddr = getAssetInfo('WETH', chainIds[network]).address;
        daiAddr = getAssetInfo('DAI', chainIds[network]).address;

        const aaveMarketContract = await hre.ethers.getContractAt('IPoolAddressesProvider', addrs[network].AAVE_MARKET);
        const poolAddress = await aaveMarketContract.getPool();
        const poolContractName = network !== 'mainnet' ? 'IL2PoolV3' : 'IPoolV3';
        pool = await hre.ethers.getContractAt(poolContractName, poolAddress);

        const collAmountInUSD = fetchAmountinUSDPrice('WETH', '100000');
        const debtAmountInUSD = fetchAmountinUSDPrice('DAI', '40000');
        const supplyAmountInWei = hre.ethers.utils.parseUnits(
            collAmountInUSD, 18,
        );
        const borrowAmountWei = hre.ethers.utils.parseUnits(
            debtAmountInUSD, 18,
        );

        await setBalance(
            wethAddr, senderAcc.address, supplyAmountInWei,
        );
        await approve(wethAddr, poolAddress, senderAcc);
        await pool.supply(wethAddr, supplyAmountInWei, senderAcc.address, 0);
        await pool.borrow(daiAddr, borrowAmountWei, 2, 0, senderAcc.address);
        console.log('We\'ve supplied 100k$ of WETH');
        console.log('We\'ve borrowed 40k$ DAI');
    });

    it('... should repay EOA position', async () => {
        const aWETH = '0x4d5F47FA6A74757f35C14fD3a6Ef8E3C9BC514E8';
        const owner = senderAcc.address;
        const spender = proxy.address;
        const repayAmount = hre.ethers.utils.parseUnits(fetchAmountinUSDPrice('WETH', '20000'), 18);
        const aTokenContract = await hre.ethers.getContractAt('IAToken', aWETH);
        const nonce = await aTokenContract.nonces(senderAcc.address);
        const deadline = '1812843907';
        const exchangeData = await formatMockExchangeObj(
            getAssetInfo('WETH'),
            getAssetInfo('DAI'),
            repayAmount,
        );
        const signature = hre.ethers.utils.splitSignature(
            // @dev - _signTypedData will be renamed to signTypedData in future ethers versions
            // eslint-disable-next-line no-underscore-dangle
            await senderAcc._signTypedData(
                {
                    name: 'Aave Ethereum WETH', // aToken.name
                    version: '1', // aToken.ATOKEN_REVISION
                    chainId: 1,
                    verifyingContract: aWETH,
                },
                {
                    Permit: [
                        { name: 'owner', type: 'address' },
                        { name: 'spender', type: 'address' },
                        { name: 'value', type: 'uint256' },
                        { name: 'nonce', type: 'uint256' },
                        { name: 'deadline', type: 'uint256' },
                    ],
                },
                {
                    owner,
                    spender,
                    value: repayAmount,
                    nonce, // aToken.nonces(owner)
                    deadline,
                },
            ),
        );
        const permitAction = new dfs.actions.basic.PermitTokenAction(
            aWETH, senderAcc.address, proxy.address, repayAmount, deadline,
            signature.v, signature.r, signature.s,
        );
        const pullTokenAction = new dfs.actions.basic.PullTokenAction(
            aWETH, senderAcc.address, repayAmount,
        );
        const withdrawAction = new dfs.actions.aaveV3.AaveV3WithdrawAction(
            true, nullAddress, repayAmount, proxy.address, 0,
        );
        const sellAction = new dfs.actions.basic.SellAction(
            exchangeData, proxy.address, proxy.address,
        );
        const paybackAction = new dfs.actions.aaveV3.AaveV3PaybackAction(
            true, nullAddress, '$4', proxy.address, 2, daiAddr, 4, true, senderAcc.address,
        );

        const recipe = new dfs.Recipe('AaveV3EOARepay',
            [permitAction, pullTokenAction, withdrawAction, sellAction, paybackAction]);
        const functionData = recipe.encodeForDsProxyCall()[1];
        const view = await (await hre.ethers.getContractFactory('AaveV3View')).deploy();
        const loanDataPre = await view.getLoanData(addrs[network].AAVE_MARKET, senderAcc.address);
        await executeAction('RecipeExecutor', functionData, proxy);

        const loanData = await view.getLoanData(addrs[network].AAVE_MARKET, senderAcc.address);
        expect(loanDataPre.collAmounts[0]).to.be.gt(loanData.collAmounts[0]);
        expect(loanDataPre.borrowVariableAmounts[0]).to.be.gt(loanData.borrowVariableAmounts[0]);
        console.log(`Our position currently has ${loanData.collAmounts[0] / 1e8}$ of ETH supplied`);
        console.log(`Our position currently has ${loanData.borrowVariableAmounts[0] / 1e8}$ of DAI borrowed`);
    });
});
