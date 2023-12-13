// SPDX-License-Identifier: MIT
pragma solidity =0.8.10;

import "../ActionBase.sol";
import "../../interfaces/IDSProxy.sol";
import "../../interfaces/IFLParamGetter.sol";
import "../../interfaces/aaveV2/ILendingPoolAddressesProviderV2.sol";
import "../../interfaces/aaveV2/ILendingPoolV2.sol";
import "../../core/strategy/StrategyModel.sol";
import "../../utils/TokenUtils.sol";
import "../../utils/ReentrancyGuard.sol";
import "./helpers/FLHelper.sol";
import "../../interfaces/flashloan/IFlashLoanBase.sol";

/// @title Action that gets and receives a FL from Aave V3 and does not return funds but opens debt position on Aave V3
contract FLAaveV3CarryDebt is ActionBase, StrategyModel, ReentrancyGuard, FLHelper, IFlashLoanBase {
    using SafeERC20 for IERC20;
    using TokenUtils for address;
    //Caller not aave pool
    error OnlyAaveCallerError();
    //FL Taker must be this contract
    error SameCallerError();
    //Interest rate can't be 0 for opening depth position on Aave V3
    error NoInterestRateSetError();

    string constant ERR_ONLY_AAVE_CALLER = "Caller not aave pool";
    string constant ERR_SAME_CALLER = "FL taker must be this contract";
    string constant ERR_WRONG_PAYBACK_AMOUNT = "Wrong FL payback amount sent";

    ILendingPoolAddressesProviderV2
        public constant addressesProvider = ILendingPoolAddressesProviderV2(
            AAVE_V3_LENDING_POOL_ADDRESS_PROVIDER
    );

    bytes4 constant RECIPE_EXECUTOR_ID = bytes4(keccak256("RecipeExecutor"));

    /// @inheritdoc ActionBase
    function executeAction(
        bytes memory _callData,
        bytes32[] memory,
        uint8[] memory,
        bytes32[] memory
    ) public override payable returns (bytes32) {
        FlashLoanParams memory flData = parseInputs(_callData);

        // check to make sure modes are not 0
        for (uint256 i = 0; i < flData.modes.length; i++) {
            if (flData.modes[i] == 0) {
                revert NoInterestRateSetError();
            }
        }

        // if we want to get on chain info about FL params
        if (flData.flParamGetterAddr != address(0)) {
            (flData.tokens, flData.amounts, flData.modes) =
                IFLParamGetter(flData.flParamGetterAddr).getFlashLoanParams(flData.flParamGetterData);
        }

        bytes memory recipeData = flData.recipeData;
        uint flAmount = _flAaveV3(flData, recipeData);

        return bytes32(flAmount);
    }

    // solhint-disable-next-line no-empty-blocks
    function executeActionDirect(bytes memory _callData) public override payable {}

    /// @inheritdoc ActionBase
    function actionType() public override pure returns (uint8) {
        return uint8(ActionType.FL_ACTION);
    }

    //////////////////////////// ACTION LOGIC ////////////////////////////

    /// @notice Gets a Fl from AaveV3 and returns back the execution to the action address
    /// @param _flData All the amounts/tokens and related aave fl data
    /// @param _params Rest of the data we have in the recipe
    function _flAaveV3(FlashLoanParams memory _flData, bytes memory _params) internal returns (uint) {

        ILendingPoolV2(AAVE_V3_LENDING_POOL).flashLoan(
            address(this),
            _flData.tokens,
            _flData.amounts,
            _flData.modes,
            _flData.onBehalfOf,
            _params,
            AAVE_REFERRAL_CODE
        );

        emit ActionEvent(
            "FLAaveV3",
            abi.encode(_flData.tokens, _flData.amounts, _flData.modes, _flData.onBehalfOf)
        );

        return _flData.amounts[0];
    }

    /// @notice Aave callback function that formats and calls back RecipeExecutor
    /// @dev FL amount is not returned, instead debt position is opened
    function executeOperation(
        address[] memory _assets,
        uint256[] memory _amounts,
        uint256[] memory _fees,
        address _initiator,
        bytes memory _params
    ) public nonReentrant returns (bool) {
        if (msg.sender != AAVE_V3_LENDING_POOL){
            revert OnlyAaveCallerError();
        }
        if (_initiator != address(this)){
            revert SameCallerError();
        }

        (Recipe memory currRecipe, address proxy) = abi.decode(_params, (Recipe, address));

        // Send FL amounts to user proxy
        for (uint256 i = 0; i < _assets.length; ++i) {
            _assets[i].withdrawTokens(proxy, _amounts[i]);
        }

        address payable recipeExecutor = payable(registry.getAddr(RECIPE_EXECUTOR_ID));

        // call Action execution
        IDSProxy(proxy).execute{value: address(this).balance}(
            recipeExecutor,
            abi.encodeWithSignature("_executeActionsFromFL((string,bytes[],bytes32[],bytes4[],uint8[][]),bytes32)", currRecipe, bytes32(_amounts[0] + _fees[0]))
        );

        return true;
    }

    function parseInputs(bytes memory _callData) public pure returns (FlashLoanParams memory inputData) {
        inputData = abi.decode(_callData, (FlashLoanParams));
    }

    // solhint-disable-next-line no-empty-blocks
    receive() external payable {}
}
