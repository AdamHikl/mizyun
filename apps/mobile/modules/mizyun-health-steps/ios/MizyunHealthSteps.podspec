Pod::Spec.new do |s|
  s.name             = 'MizyunHealthSteps'
  s.version          = '1.0.0'
  s.summary          = 'Read-only daily step totals for Mizyun.'
  s.description      = 'A local Expo module that reads optional HealthKit step totals.'
  s.license          = { :type => 'MIT' }
  s.author           = 'Mizyun'
  s.homepage         = 'https://www.phiskel.com/mizyun'
  s.platform         = :ios, '16.4'
  s.swift_version    = '5.9'
  s.source           = { :git => 'https://github.com/AdamHikl/mizyun.git' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks        = 'HealthKit'
  s.source_files      = '**/*.swift'
end
