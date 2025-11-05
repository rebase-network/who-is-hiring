import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, MapPin, DollarSign, Briefcase, ExternalLink, Calendar, Filter } from 'lucide-react'
import './App.css'

function JobList() {
  const navigate = useNavigate()
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingProgress, setLoadingProgress] = useState({ current: 0, total: 0 })
  const [searchTerm, setSearchTerm] = useState('')
  const [locationFilter, setLocationFilter] = useState('')
  const [showFilters, setShowFilters] = useState(false)

  useEffect(() => {
    fetchJobs()
  }, [])

  const fetchJobs = async () => {
    try {
      setLoading(true)
      let allJobs = []
      let page = 1
      let hasMore = true
      const perPage = 100 // GitHub API 最大支持 100
      
      // 循环获取所有分页数据
      while (hasMore) {
        const response = await fetch(
          `https://api.github.com/repos/rebase-network/who-is-hiring/issues?state=open&per_page=${perPage}&page=${page}`
        )
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }
        
        const data = await response.json()
        
        if (data.length === 0) {
          hasMore = false
        } else {
          // 过滤掉 pull requests 和不是招聘的 issues
          const jobIssues = data.filter(issue => 
            !issue.pull_request && 
            issue.title !== 'Feature Request: Add Job Categories to Job Listings'
          )
          
          allJobs = [...allJobs, ...jobIssues]
          setJobs(allJobs) // 实时更新，让用户看到加载进度
          setLoadingProgress({ current: allJobs.length, total: allJobs.length })
          
          // 如果返回的数据少于 perPage，说明这是最后一页
          if (data.length < perPage) {
            hasMore = false
          } else {
            page++
            // 添加小延迟避免触发 GitHub API 速率限制
            await new Promise(resolve => setTimeout(resolve, 100))
          }
        }
      }
      
      setJobs(allJobs)
      console.log(`成功加载 ${allJobs.length} 条招聘信息`)
    } catch (error) {
      console.error('Error fetching jobs:', error)
      alert('加载招聘信息时出错，请刷新页面重试')
    } finally {
      setLoading(false)
    }
  }

  // 从标题中提取信息
  const extractJobInfo = (title) => {
    const locationMatch = title.match(/\[([^\]]+)\]/)
    const salaryMatch = title.match(/(\d+[kK]?\-?\d*[kK]?)\s*(RMB|USD|USDT|SGD)/i)
    
    return {
      location: locationMatch ? locationMatch[1] : '未指定',
      salary: salaryMatch ? salaryMatch[0] : null,
      title: title.replace(/\[([^\]]+)\]/g, '').trim()
    }
  }

  // 过滤招聘信息
  const filteredJobs = jobs.filter(job => {
    const jobInfo = extractJobInfo(job.title)
    const matchesSearch = job.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         job.body?.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesLocation = !locationFilter || jobInfo.location.includes(locationFilter)
    
    return matchesSearch && matchesLocation
  })

  // 获取所有独特的地点
  const locations = [...new Set(jobs.map(job => {
    const info = extractJobInfo(job.title)
    return info.location
  }))].sort()

  const formatDate = (dateString) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Header */}
      <header className="bg-white shadow-md sticky-header-mobile">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 md:py-6">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex-1 min-w-0">
              <h1 className="text-xl md:text-3xl font-bold text-gray-900 truncate">
                Who is Hiring
              </h1>
              <p className="mt-1 md:mt-2 text-sm md:text-base text-gray-600 hidden sm:block">
                区块链行业招聘信息平台 · Rebase 社区
              </p>
            </div>
            <a
              href="https://github.com/rebase-network/who-is-hiring/issues/new?template=hiring.md"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center px-3 md:px-4 py-2 border border-transparent text-sm md:text-base font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 whitespace-nowrap"
            >
              <span className="hidden sm:inline">发布职位</span>
              <span className="sm:hidden">发布</span>
              <ExternalLink className="ml-1 md:ml-2 h-4 w-4 md:h-5 md:w-5" />
            </a>
          </div>
        </div>
      </header>

      {/* Stats Banner */}
      <div className="bg-indigo-600 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-center space-x-8">
            <div className="text-center">
              <div className="text-3xl font-bold">{jobs.length}</div>
              <div className="text-indigo-200 text-sm">开放职位</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold">{locations.length}</div>
              <div className="text-indigo-200 text-sm">招聘地区</div>
            </div>
          </div>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-lg shadow-md p-6">
          {/* 显示筛选结果统计 */}
          {!loading && jobs.length > 0 && (
            <div className="mb-4 text-sm text-gray-600">
              {searchTerm || locationFilter ? (
                <span>
                  找到 <span className="font-semibold text-indigo-600">{filteredJobs.length}</span> 条匹配的职位
                  （共 {jobs.length} 条）
                </span>
              ) : (
                <span>
                  共有 <span className="font-semibold text-indigo-600">{jobs.length}</span> 条开放职位
                </span>
              )}
            </div>
          )}
          
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
              <input
                type="text"
                placeholder="搜索职位、公司、技能..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
              <Filter className="mr-2 h-5 w-5" />
              筛选
            </button>
          </div>

          {showFilters && (
            <div className="mt-4 pt-4 border-t border-gray-200">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    <MapPin className="inline h-4 w-4 mr-1" />
                    地点
                  </label>
                  <select
                    value={locationFilter}
                    onChange={(e) => setLocationFilter(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  >
                    <option value="">所有地点</option>
                    {locations.map(location => (
                      <option key={location} value={location}>
                        {location}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Job Listings */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
        {loading && jobs.length === 0 ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
            <p className="mt-4 text-gray-600">正在加载招聘信息...</p>
            {loadingProgress.current > 0 && (
              <p className="mt-2 text-gray-500 text-sm">
                已加载 {loadingProgress.current} 条
              </p>
            )}
          </div>
        ) : (
          <>
            {loading && jobs.length > 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4 text-center">
                <p className="text-blue-700">
                  正在加载更多数据... 已加载 {jobs.length} 条
                </p>
              </div>
            )}
            <div className="space-y-4">
              {filteredJobs.length === 0 ? (
                <div className="bg-white rounded-lg shadow-md p-12 text-center">
                  <Briefcase className="mx-auto h-12 w-12 text-gray-400" />
                  <h3 className="mt-4 text-lg font-medium text-gray-900">未找到职位</h3>
                  <p className="mt-2 text-gray-500">试试调整您的搜索条件</p>
                </div>
              ) : (
                filteredJobs.map((job) => {
                  const jobInfo = extractJobInfo(job.title)
                return (
                  <div
                    key={job.id}
                    className="job-card bg-white rounded-lg shadow-md p-4 md:p-6 hover:shadow-lg transition-all duration-200 cursor-pointer active:bg-gray-50"
                    onClick={() => navigate(`/job/${job.number}`)}
                  >
                    <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-lg md:text-xl font-semibold text-gray-900 mb-2 hover:text-indigo-600 line-clamp-2">
                          {jobInfo.title}
                        </h3>
                        <div className="flex flex-wrap gap-2 mb-3">
                          <span className="inline-flex items-center px-2 md:px-3 py-1 rounded-full text-xs md:text-sm font-medium bg-blue-100 text-blue-800">
                            <MapPin className="mr-1 h-3 w-3 md:h-4 md:w-4 flex-shrink-0" />
                            <span className="truncate max-w-[120px]">{jobInfo.location}</span>
                          </span>
                          {jobInfo.salary && (
                            <span className="inline-flex items-center px-2 md:px-3 py-1 rounded-full text-xs md:text-sm font-medium bg-green-100 text-green-800">
                              <DollarSign className="mr-1 h-3 w-3 md:h-4 md:w-4 flex-shrink-0" />
                              {jobInfo.salary}
                            </span>
                          )}
                          <span className="inline-flex items-center px-2 md:px-3 py-1 rounded-full text-xs md:text-sm font-medium bg-gray-100 text-gray-800">
                            <Calendar className="mr-1 h-3 w-3 md:h-4 md:w-4 flex-shrink-0" />
                            {formatDate(job.created_at)}
                          </span>
                        </div>
                        {job.body && (
                          <p className="text-gray-600 text-sm md:text-base line-clamp-2 mb-3">
                            {job.body.substring(0, 150)}...
                          </p>
                        )}
                      </div>
                      <div className="md:ml-6 flex-shrink-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            navigate(`/job/${job.number}`)
                          }}
                          className="w-full md:w-auto inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                        >
                          查看详情
                          <ExternalLink className="ml-2 h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })
              )}
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <footer className="bg-gray-800 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="text-center">
            <p className="text-gray-300">
              由 <a href="https://rebase.network" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:text-indigo-300">Rebase 社区</a> 维护
            </p>
            <p className="mt-2 text-gray-400 text-sm">
              所有招聘信息由招聘方自行发布，请注意甄别信息真实性
            </p>
            <div className="mt-4">
              <a
                href="https://github.com/rebase-network/who-is-hiring"
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-400 hover:text-white"
              >
                GitHub
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}

export default JobList
