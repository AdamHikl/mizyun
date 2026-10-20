Pod::Spec.new do |s|
  s.name             = 'MizyunOnDeviceLlm'
  s.version          = '1.0.0'
  s.summary          = 'On-device language model access for Mizyun.'
  s.description      = 'A local Expo module that runs short prompts on Apple Foundation Models without sending them off the device.'
  s.license          = { :type => 'MIT' }
  s.author           = 'Mizyun'
  s.homepage         = 'https://www.phiskel.com/mizyun'
  s.platform         = :ios, '16.4'
  s.swift_version    = '5.9'
  s.source           = { :git => 'https://github.com/AdamHikl/mizyun.git' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  # Foundation Models exists from iOS 26; weak-link it for older systems.
  s.weak_frameworks   = 'FoundationModels'
  s.source_files      = '**/*.swift'
end
