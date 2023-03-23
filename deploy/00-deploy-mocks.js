const { network } = require("hardhat")
const { developmentChains, BASE_FEE, GAS_PRICE_LINK } = require("../helper-hardhat-config")

module.exports = async function ({ getNamedAccounts, deployments }) {
    const { deploy, log } = deployments
    const { deployer } = await getNamedAccounts()
    const chainId = network.config.chainId
    const args = [BASE_FEE, GAS_PRICE_LINK] //args are the arguments passed to the constructor function of the contract

    if (developmentChains.includes(network.name)) {
        log("local network detected. Deploying mocks.....")
        //deploy a mock VRFCoordinator....
        await deploy("VRFCoordinatorV2Mock", {
            from: deployer,
            logs: true,
            args: args,
        })
        log("Mocks Deployed!!")
        log("------------------------------------------------------")
    }
}

module.exports.tags = ["all", "mocks"]
